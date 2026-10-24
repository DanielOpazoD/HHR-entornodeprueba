import type {
  DailyRecordAuthorityAdoptionResult,
  DailyRecordPendingProjectionRebase,
  SyncQueueLeaseClaim,
  SyncQueueStorePort,
  SyncQueueTaskWriteMode,
} from '@/services/storage/sync/syncQueuePorts';
import {
  buildDailyRecordSyncContract,
  mergeSyncTaskContracts,
} from '@/services/storage/sync/syncTaskContractPolicy';
import { buildRecordOverlayRebase } from '@/services/storage/sync/pendingDailyRecordProjectionPolicy';
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
  REUSABLE_TASK_STATES,
} from '@/services/storage/sync/dexieSyncQueueQuarantine';

const isReadyForClaim = (task: SyncTask, now: number): boolean => {
  if ((task.preOutboxHoldUntil || 0) > now) {
    return false;
  }

  if ((task.nextAttemptAt || 0) > now) {
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

/** The local projection when an unresolved write of this owner still holds it as its payload. */
const findPendingProjection = async (
  date: string,
  task: SyncTask
): Promise<{ projection: DailyRecord; owner: SyncTask } | null> => {
  const projection = await hospitalDB.dailyRecords.get(date);
  if (!projection) return null;
  const owner = (await listUnresolvedDailyRecordTasks(date)).find(
    candidate =>
      candidate.type === task.type &&
      matchesOwner(task.ownerKey, candidate.ownerKey) &&
      (candidate.payload as Partial<DailyRecord> | null | undefined)?.lastUpdated ===
        projection.lastUpdated
  );
  return owner ? { projection, owner } : null;
};

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

export const createDexieSyncQueueStore = (): SyncQueueStorePort => ({
  withEnqueueTransaction: operation =>
    hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => operation()),
  async listAll(ownerKey) {
    const tasks = await hospitalDB.syncQueue.toArray();
    return tasks.filter(task => matchesOwner(ownerKey, task.ownerKey));
  },
  async listRecent(limit, ownerKey) {
    const tasks = await hospitalDB.syncQueue.orderBy('timestamp').reverse().toArray();
    return tasks.filter(task => matchesOwner(ownerKey, task.ownerKey)).slice(0, limit);
  },
  async claimReadyPending(
    now: number,
    limit: number,
    ownerKey: string | null | undefined,
    claim: SyncQueueLeaseClaim
  ): Promise<SyncTask[]> {
    return hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => {
      const tasks = await hospitalDB.syncQueue.orderBy('timestamp').toArray();
      const readyTasks = tasks
        .filter(task => matchesOwner(ownerKey, task.ownerKey) && isReadyForClaim(task, now))
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
  async saveDailyRecordWithTask(
    record: DailyRecord,
    task: SyncTask,
    rebaseOntoPendingProjection?: DailyRecordPendingProjectionRebase
  ): Promise<SyncQueueTaskWriteMode> {
    const { mode, persistedRecord } = await hospitalDB.transaction(
      'rw',
      hospitalDB.dailyRecords,
      hospitalDB.syncQueue,
      async () => {
        // The projection and its unresolved write are the day's pending truth. A write built
        // from another base lands on top of them instead of replacing them.
        const rebase =
          rebaseOntoPendingProjection ??
          buildRecordOverlayRebase(record, task.syncContract?.changedPaths);
        const pending = rebase ? await findPendingProjection(record.date, task) : null;
        const rebasedRecord =
          pending && rebase
            ? rebase({
                projection: pending.projection,
                pendingChangedPaths: pending.owner.syncContract?.changedPaths ?? [],
              })
            : null;
        const persistedRecord = rebasedRecord ?? record;
        const existing = task.key
          ? await findReusableSyncTask(task.type, task.key, task.ownerKey)
          : null;
        const mergedContract = mergeSyncTaskContracts(existing?.syncContract, task.syncContract);
        const nextTask: SyncTask =
          rebasedRecord && pending
            ? {
                ...task,
                payload: rebasedRecord,
                // The payload now derives from the projection, so it keeps that write's remote base.
                syncContract: buildDailyRecordSyncContract(rebasedRecord, {
                  ...mergedContract,
                  expectedVersion:
                    pending.owner.syncContract?.expectedVersion ?? mergedContract?.expectedVersion,
                  baseRevision: pending.owner.syncContract?.baseRevision,
                }),
              }
            : { ...task, syncContract: mergedContract };

        await hospitalDB.dailyRecords.put(persistedRecord);
        if (existing?.id) {
          await hospitalDB.syncQueue.put({ ...existing, ...nextTask, id: existing.id });
          return { mode: 'reused' as const, persistedRecord };
        }

        await hospitalDB.syncQueue.add(nextTask);
        return { mode: 'created' as const, persistedRecord };
      }
    );

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
    const outcome: DailyRecordAuthorityAdoptionResult = await hospitalDB.transaction(
      'rw',
      hospitalDB.dailyRecords,
      hospitalDB.syncQueue,
      async () => {
        const unresolvedTasks = (
          await listUnresolvedDailyRecordTasks(authoritativeRecord.date)
        ).filter(task => matchesOwner(ownerKey, task.ownerKey));
        const blocked = { status: 'blocked' as const };
        if (unresolvedTasks.length === 0) {
          await hospitalDB.dailyRecords.put(authoritativeRecord);
          return { status: 'adopted' as const, record: authoritativeRecord };
        }
        if (unresolvedTasks.length !== 1) return blocked;
        const [pendingTask] = unresolvedTasks;
        const localRecord = await hospitalDB.dailyRecords.get(authoritativeRecord.date);
        const pendingPayload = pendingTask.payload as Partial<DailyRecord> | null | undefined;
        if (
          !REUSABLE_TASK_STATES.has(pendingTask.status) ||
          !localRecord ||
          pendingPayload?.date !== localRecord.date ||
          pendingPayload.lastUpdated !== localRecord.lastUpdated
        ) {
          return blocked;
        }
        const replacement = buildReplacement(localRecord, pendingTask);
        // A confirmed command may fully supersede quarantine. Residual edits must
        // remain quarantined; reconciliation alone does not authorize retrying them.
        if (
          !replacement ||
          !pendingTask.id ||
          (pendingTask.status !== 'PENDING' && replacement.task !== null)
        )
          return blocked;
        await hospitalDB.dailyRecords.put(replacement.record);
        if (replacement.task === null) {
          // Supersesión total: el comando confirmado ya cubre todo lo pendiente.
          // Reemplazarla re-declararía paths ya aplicados y mantendría viva la
          // propiedad del subárbol, bloqueando el siguiente comando cama–cuna.
          await hospitalDB.syncQueue.delete(pendingTask.id);
          return { status: 'adopted' as const, record: replacement.record };
        }
        await hospitalDB.syncQueue.put({
          ...pendingTask,
          ...replacement.task,
          id: pendingTask.id,
        });
        return { status: 'replaced' as const, record: replacement.record };
      }
    );
    if (outcome.record) mirrorTransactionalDailyRecordWrite(outcome.record);
    return outcome;
  },
  deletePendingByKey: (type, key, ownerKey, mutationId) =>
    withPendingTask(type, key, ownerKey, mutationId, async task => {
      await hospitalDB.syncQueue.delete(task.id);
      return true;
    }),
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
  discardQuarantinedTask,
  async update(taskId, patch) {
    await hospitalDB.syncQueue.update(taskId, patch);
  },
  async updateClaimed(taskId, patch, claim) {
    return hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => {
      const task = await hospitalDB.syncQueue.get(taskId);
      if (!matchesTaskClaim(task, claim)) {
        return false;
      }
      await hospitalDB.syncQueue.update(taskId, patch);
      return true;
    });
  },
  async delete(taskId) {
    await hospitalDB.syncQueue.delete(taskId);
  },
  async deleteClaimed(taskId, claim, authoritativeRecord) {
    const { completeClaimedSyncTask } = await import('./dexieSyncQueueAuthorityAck');
    const result = await completeClaimedSyncTask(
      {
        db: hospitalDB,
        matchesClaim: matchesTaskClaim,
        pending: listUnresolvedDailyRecordTasks,
      },
      taskId,
      claim,
      authoritativeRecord
    );
    if (result.adopted && authoritativeRecord)
      mirrorTransactionalDailyRecordWrite(authoritativeRecord);
    return result.deleted;
  },
  async deleteAll() {
    await hospitalDB.syncQueue.clear();
  },
  async deleteByOwner(ownerKey) {
    if (!ownerKey) {
      await hospitalDB.syncQueue.filter(task => !task.ownerKey).delete();
      return;
    }

    await hospitalDB.syncQueue
      .filter(task => task.ownerKey === ownerKey || !task.ownerKey)
      .delete();
  },
  async countForeign(ownerKey) {
    if (!ownerKey) {
      return hospitalDB.syncQueue.filter(task => !!task.ownerKey).count();
    }

    return hospitalDB.syncQueue
      .filter(task => !!task.ownerKey && task.ownerKey !== ownerKey)
      .count();
  },
});
