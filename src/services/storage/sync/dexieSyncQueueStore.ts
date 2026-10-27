import Dexie from 'dexie';
import { isFunctionsReloadRequired } from '@/services/firebase-runtime/functionsModuleLoader';
import type {
  SyncQueueLeaseClaim,
  SyncQueueStorePort,
} from '@/services/storage/sync/syncQueuePorts';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { dispatchDailyRecordStoreChanged } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { localPersistence } from '@/services/storage/localpersistence/localPersistenceService';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { matchesTaskClaim } from '@/services/storage/sync/syncQueueTaskFactory';
import { isE2ERuntimeEnabled } from '@/shared/runtime/e2eRuntime';
import {
  discardQuarantinedTask,
  findReusableSyncTask,
  matchesOwner,
  requeueQuarantinedTask,
  listUnresolvedDailyRecordTasks,
} from '@/services/storage/sync/dexieSyncQueueQuarantine';

const isReadyForClaim = (task: SyncTask, now: number): boolean => {
  if ((task.preOutboxHoldUntil || 0) > now) {
    return false;
  }

  if (
    (task.nextAttemptAt || 0) > now &&
    (task.lastErrorAction !== 'reload_functions' || isFunctionsReloadRequired())
  ) {
    return false;
  }

  if (task.status === 'PENDING') {
    return true;
  }

  return task.status === 'PROCESSING' && Boolean(task.leaseUntil && task.leaseUntil <= now);
};

const matchesMutation = (task: SyncTask, mutationId?: string): boolean =>
  !mutationId || task.syncContract?.mutationId === mutationId;

/** Key-scoped lookups retain the owner, mutation and state fences inside one transaction. */
const withPendingTask = (
  type: SyncTask['type'],
  key: string,
  ownerKey: string | null | undefined,
  mutationId: string | undefined,
  operation: (task: SyncTask & { id: number }) => Promise<boolean>,
  accept: (task: SyncTask) => boolean = () => true
): Promise<boolean> =>
  hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => {
    const task = (await hospitalDB.syncQueue.where('key').equals(key).toArray()).find(
      candidate =>
        candidate.type === type &&
        matchesOwner(ownerKey, candidate.ownerKey) &&
        candidate.status === 'PENDING' &&
        matchesMutation(candidate, mutationId) &&
        accept(candidate)
    );
    return task?.id ? operation({ ...task, id: task.id }) : false;
  });

const mirrorTransactionalDailyRecordWrite = (record: DailyRecord): void => {
  if (isE2ERuntimeEnabled() && typeof window !== 'undefined' && window.__HHR_E2E_OVERRIDE__) {
    try {
      localPersistence.records.save(record);
      window.__HHR_E2E_OVERRIDE__[record.date] = record;
    } catch (error) {
      recordOperationalErrorTelemetry('indexeddb', 'sync_outbox_record_mirror_failed', error, {
        code: 'sync_outbox_record_mirror_failed',
        message: 'La transacción quedó guardada, pero falló su espejo local de pruebas.',
        severity: 'warning',
        userSafeMessage: 'La transacción principal quedó guardada.',
        context: { date: record.date },
      });
    }
  }

  dispatchDailyRecordStoreChanged({ operation: 'save', dates: [record.date] });
};

const reconcileSpecialistHandoffProjections = async (): Promise<void> => {
  const { reconcileSpecialistHandoffProjections: release } =
    await import('./dexieDailyRecordOutbox');
  const dates = await release();
  if (dates.length) dispatchDailyRecordStoreChanged({ operation: 'save', dates });
};

export const createDexieSyncQueueStore = (): SyncQueueStorePort => ({
  withEnqueueTransaction: operation =>
    hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => operation()),
  async listAll(ownerKey) {
    const tasks = await hospitalDB.syncQueue.toArray();
    return tasks.filter(task => matchesOwner(ownerKey, task.ownerKey));
  },
  async listRecent(limit, ownerKey) {
    return hospitalDB.syncQueue
      .orderBy('timestamp')
      .reverse()
      .filter(task => task.status !== 'RETIRED' && matchesOwner(ownerKey, task.ownerKey))
      .limit(limit)
      .toArray();
  },
  async claimReadyPending(
    now: number,
    limit: number,
    ownerKey: string | null | undefined,
    claim: SyncQueueLeaseClaim
  ): Promise<SyncTask[]> {
    return hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => {
      const readState = (status: 'PENDING' | 'PROCESSING') =>
        hospitalDB.syncQueue
          .where('[status+timestamp]')
          .between([status, Dexie.minKey], [status, Dexie.maxKey], true, true)
          .filter(task => matchesOwner(ownerKey, task.ownerKey) && isReadyForClaim(task, now))
          .limit(limit)
          .toArray();
      const candidates = await Promise.all([readState('PENDING'), readState('PROCESSING')]);
      // Each range is ordered already; its first limit rows contain every possible batch member.
      const readyTasks = candidates
        .flat()
        .sort((a, b) => a.timestamp - b.timestamp || (a.id ?? 0) - (b.id ?? 0))
        .slice(0, limit);

      const claimedTasks: SyncTask[] = [];
      for (const task of readyTasks) {
        if (!task.id) continue;
        const claimedTask: SyncTask = {
          ...task,
          status: 'PROCESSING',
          leaseOwner: claim.leaseOwner,
          leaseUntil: claim.leaseUntil,
          attemptId: claim.attemptId,
          processingStartedAt: now,
        };
        await hospitalDB.syncQueue.put(claimedTask);
        claimedTasks.push(claimedTask);
      }

      return claimedTasks;
    });
  },
  findReusableTask: findReusableSyncTask,
  async add(task) {
    await hospitalDB.syncQueue.add(task);
  },
  async saveDailyRecordWithTask(record, task, patchWrite, wholeRecordBase) {
    const { mode, persistedRecord } = await (
      await import('./dexieDailyRecordOutbox')
    ).saveDailyRecordInOutbox(record, task, patchWrite, wholeRecordBase);
    mirrorTransactionalDailyRecordWrite(persistedRecord);
    return mode;
  },
  async replacePendingDailyRecordWithTask(record, task, expectedTask) {
    if (!task.id) return false;
    const replaced = await hospitalDB.transaction(
      'rw',
      hospitalDB.dailyRecords,
      hospitalDB.syncQueue,
      async () => {
        const existing = await hospitalDB.syncQueue.get(task.id!);
        if (
          !existing ||
          existing.status !== 'PENDING' ||
          existing.type !== task.type ||
          existing.key !== task.key ||
          !matchesOwner(task.ownerKey, existing.ownerKey) ||
          (expectedTask &&
            (existing.id !== expectedTask.taskId ||
              (existing.payload as Partial<DailyRecord> | null | undefined)?.lastUpdated !==
                expectedTask.recordRevision ||
              existing.syncContract?.mutationId !== expectedTask.mutationId))
        ) {
          return false;
        }
        await hospitalDB.dailyRecords.put(record);
        await hospitalDB.syncQueue.put({ ...existing, ...task, id: existing.id });
        return true;
      }
    );
    if (replaced) mirrorTransactionalDailyRecordWrite(record);
    return replaced;
  },
  async adoptAuthoritativeDailyRecord(authoritativeRecord, ownerKey, buildReplacement) {
    const { adoptAuthoritativeDailyRecordInOutbox } = await import('./dexieSyncQueueAuthorityAck');
    const outcome = await adoptAuthoritativeDailyRecordInOutbox(
      authoritativeRecord,
      ownerKey,
      buildReplacement
    );
    if (outcome.record) mirrorTransactionalDailyRecordWrite(outcome.record);
    return outcome;
  },
  deletePendingByKey: (type, key, ownerKey, mutationId) =>
    withPendingTask(
      type,
      key,
      ownerKey,
      mutationId,
      async task => {
        await hospitalDB.syncQueue.delete(task.id);
        return true;
      },
      task => !task.syncContract?.mutationIds?.some(id => id !== mutationId)
    ),
  releasePreOutboxHoldByKey: (type, key, ownerKey, mutationId) =>
    withPendingTask(type, key, ownerKey, mutationId, async task => {
      await hospitalDB.syncQueue.update(task.id, {
        nextAttemptAt: 0,
        preOutboxHoldState: undefined,
        preOutboxHoldOwner: undefined,
        preOutboxHoldUntil: undefined,
        preOutboxHoldReason: undefined,
        preOutboxHoldHeartbeatAt: undefined,
      });
      return true;
    }),
  renewPreOutboxHoldByKey: (type, key, ownerKey, mutationId, holdOwner, now, holdForMs) =>
    withPendingTask(
      type,
      key,
      ownerKey,
      mutationId,
      async task => {
        const nextHoldUntil = now + holdForMs;
        await hospitalDB.syncQueue.update(task.id, {
          nextAttemptAt: nextHoldUntil,
          preOutboxHoldUntil: nextHoldUntil,
          preOutboxHoldHeartbeatAt: now,
        });
        return true;
      },
      task =>
        task.preOutboxHoldState === 'AWAITING_REMOTE_ACK' &&
        task.preOutboxHoldOwner === holdOwner &&
        (task.preOutboxHoldUntil || 0) > now
    ),
  requeueQuarantinedTask,
  async discardQuarantinedTask(taskId, ownerKey) {
    const { releaseSpecialistHandoffProjection: release } =
      await import('./dexieDailyRecordOutbox');
    let changedDate: string | undefined;
    // Deletion and restoration commit together: a failure keeps the note and its provenance.
    const discarded = await hospitalDB.transaction(
      'rw',
      hospitalDB.dailyRecords,
      hospitalDB.syncQueue,
      async () => {
        const task = await hospitalDB.syncQueue.get(taskId);
        const applied = await discardQuarantinedTask(taskId, ownerKey);
        if (applied && task?.type === 'UPDATE_SPECIALIST_HANDOFF' && (await release(task)))
          changedDate = (task.payload as { date: string }).date;
        return applied;
      }
    );
    if (changedDate) dispatchDailyRecordStoreChanged({ operation: 'save', dates: [changedDate] });
    return discarded;
  },
  reconcileSpecialistHandoffProjections,
  async update(taskId, patch) {
    await hospitalDB.syncQueue.update(taskId, patch);
  },
  async renewClaim(taskId, leaseUntil, claim) {
    return hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => {
      const task = await hospitalDB.syncQueue.get(taskId);
      if (!task || !matchesTaskClaim(task, claim)) return null;
      await hospitalDB.syncQueue.update(taskId, { leaseUntil });
      return { ...task, leaseUntil };
    });
  },
  async updateClaimed(taskId, patch, claim) {
    const release =
      patch.status === 'FAILED' || patch.status === 'CONFLICT'
        ? (await import('./dexieDailyRecordOutbox')).releaseSpecialistHandoffProjection
        : undefined;
    let changedDate: string | undefined;
    // A refused note is quarantined only if its projection is restored in the same transaction.
    const updated = await hospitalDB.transaction(
      'rw',
      hospitalDB.dailyRecords,
      hospitalDB.syncQueue,
      async () => {
        const task = await hospitalDB.syncQueue.get(taskId);
        if (!matchesTaskClaim(task, claim)) return false;
        await hospitalDB.syncQueue.update(taskId, patch);
        if (release && task?.type === 'UPDATE_SPECIALIST_HANDOFF' && (await release(task)))
          changedDate = (task.payload as { date: string }).date;
        return true;
      }
    );
    if (changedDate) dispatchDailyRecordStoreChanged({ operation: 'save', dates: [changedDate] });
    return updated;
  },
  async delete(taskId) {
    await hospitalDB.syncQueue.delete(taskId);
  },
  async deleteClaimed(taskId, claim, authoritativeRecord, detachedConflicts) {
    const { completeClaimedSyncTask } = await import('./dexieSyncQueueAuthorityAck');
    const { confirmSpecialistHandoffProjection } = await import('./dexieDailyRecordOutbox');
    const result = await completeClaimedSyncTask(
      {
        db: hospitalDB,
        matchesClaim: matchesTaskClaim,
        pending: listUnresolvedDailyRecordTasks,
        confirmNote: confirmSpecialistHandoffProjection,
      },
      taskId,
      claim,
      authoritativeRecord,
      detachedConflicts
    );
    if (result.adopted && authoritativeRecord)
      mirrorTransactionalDailyRecordWrite(authoritativeRecord);
    if (result.noteProjectionDate)
      dispatchDailyRecordStoreChanged({ operation: 'save', dates: [result.noteProjectionDate] });
    return result.deleted;
  },
  async deleteAll() {
    await hospitalDB.syncQueue.clear();
  },
  async deleteByOwner(ownerKey) {
    await hospitalDB.syncQueue
      .filter(
        task =>
          task.retirement?.reason !== 'manual_discard' && matchesOwner(ownerKey, task.ownerKey)
      )
      .delete();
  },
  async countForeign(ownerKey) {
    return hospitalDB.syncQueue
      .filter(task => task.status !== 'RETIRED' && !!task.ownerKey && task.ownerKey !== ownerKey)
      .count();
  },
});
