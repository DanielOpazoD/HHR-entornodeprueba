import type {
  SyncQueueLeaseClaim,
  SyncQueueStorePort,
  SyncQueueTaskWriteMode,
} from '@/services/storage/sync/syncQueuePorts';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { dispatchDailyRecordStoreChanged } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { localPersistence } from '@/services/storage/localpersistence/localPersistenceService';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { isE2ERuntimeEnabled } from '@/shared/runtime/e2eRuntime';

const matchesOwner = (ownerKey: string | null | undefined, taskOwnerKey?: string): boolean =>
  ownerKey ? taskOwnerKey === ownerKey || !taskOwnerKey : !taskOwnerKey;

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

const matchesClaim = (task: SyncTask | undefined, claim: SyncQueueLeaseClaim): boolean =>
  Boolean(
    task &&
    task.status === 'PROCESSING' &&
    task.leaseOwner === claim.leaseOwner &&
    task.attemptId === claim.attemptId
  );

const matchesMutation = (task: SyncTask, mutationId?: string): boolean =>
  !mutationId || task.syncContract?.mutationId === mutationId;

const UNRESOLVED_DAILY_RECORD_STATES = new Set<SyncTask['status']>([
  'PENDING',
  'PROCESSING',
  'FAILED',
  'CONFLICT',
]);

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
  async findReusableTask(type, key, ownerKey) {
    const existing = await hospitalDB.syncQueue.where('type').equals(type).toArray();
    return (
      existing.find(
        task =>
          matchesOwner(ownerKey, task.ownerKey) && task.key === key && task.status === 'PENDING'
      ) || null
    );
  },
  async add(task) {
    await hospitalDB.syncQueue.add(task);
  },
  async saveDailyRecordWithTask(
    record: DailyRecord,
    task: SyncTask
  ): Promise<SyncQueueTaskWriteMode> {
    const mode = await hospitalDB.transaction(
      'rw',
      hospitalDB.dailyRecords,
      hospitalDB.syncQueue,
      async () => {
        await hospitalDB.dailyRecords.put(record);

        if (task.key) {
          const existing = (
            await hospitalDB.syncQueue.where('type').equals(task.type).toArray()
          ).find(
            candidate =>
              matchesOwner(task.ownerKey, candidate.ownerKey) &&
              candidate.key === task.key &&
              candidate.status === 'PENDING'
          );

          if (existing?.id) {
            await hospitalDB.syncQueue.put({ ...existing, ...task, id: existing.id });
            return 'reused';
          }
        }

        await hospitalDB.syncQueue.add(task);
        return 'created';
      }
    );

    mirrorTransactionalDailyRecordWrite(record);
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
    const outcome = await hospitalDB.transaction(
      'rw',
      hospitalDB.dailyRecords,
      hospitalDB.syncQueue,
      async () => {
        const key = `daily:${authoritativeRecord.date}`;
        const unresolvedTasks = (
          await hospitalDB.syncQueue.where('type').equals('UPDATE_DAILY_RECORD').toArray()
        ).filter(
          task =>
            task.key === key &&
            matchesOwner(ownerKey, task.ownerKey) &&
            UNRESOLVED_DAILY_RECORD_STATES.has(task.status)
        );
        if (unresolvedTasks.length === 0) {
          await hospitalDB.dailyRecords.put(authoritativeRecord);
          return { status: 'adopted' as const, record: authoritativeRecord };
        }
        if (unresolvedTasks.length !== 1) return { status: 'blocked' as const };
        const [pendingTask] = unresolvedTasks;
        const localRecord = await hospitalDB.dailyRecords.get(authoritativeRecord.date);
        const pendingPayload = pendingTask.payload as Partial<DailyRecord> | null | undefined;
        if (
          pendingTask.status !== 'PENDING' ||
          !matchesOwner(ownerKey, pendingTask.ownerKey) ||
          !localRecord ||
          pendingPayload?.date !== localRecord.date ||
          pendingPayload.lastUpdated !== localRecord.lastUpdated
        ) {
          return { status: 'blocked' as const };
        }
        const replacement = buildReplacement(localRecord, pendingTask);
        if (!replacement || !pendingTask.id) return { status: 'blocked' as const };
        await hospitalDB.dailyRecords.put(replacement.record);
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
  async deletePendingByKey(type, key, ownerKey, mutationId) {
    return hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => {
      const existing = (await hospitalDB.syncQueue.where('type').equals(type).toArray()).find(
        task =>
          matchesOwner(ownerKey, task.ownerKey) &&
          task.key === key &&
          task.status === 'PENDING' &&
          matchesMutation(task, mutationId)
      );
      if (!existing?.id) {
        return false;
      }
      await hospitalDB.syncQueue.delete(existing.id);
      return true;
    });
  },
  async releasePreOutboxHoldByKey(type, key, ownerKey, mutationId) {
    return hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => {
      const existing = (await hospitalDB.syncQueue.where('type').equals(type).toArray()).find(
        task =>
          matchesOwner(ownerKey, task.ownerKey) &&
          task.key === key &&
          task.status === 'PENDING' &&
          matchesMutation(task, mutationId)
      );
      if (!existing?.id) {
        return false;
      }
      await hospitalDB.syncQueue.update(existing.id, {
        nextAttemptAt: 0,
        preOutboxHoldState: undefined,
        preOutboxHoldOwner: undefined,
        preOutboxHoldUntil: undefined,
        preOutboxHoldReason: undefined,
        preOutboxHoldHeartbeatAt: undefined,
      });
      return true;
    });
  },
  async renewPreOutboxHoldByKey(type, key, ownerKey, mutationId, holdOwner, now, holdForMs) {
    return hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => {
      const existing = (await hospitalDB.syncQueue.where('type').equals(type).toArray()).find(
        task =>
          matchesOwner(ownerKey, task.ownerKey) &&
          task.key === key &&
          task.status === 'PENDING' &&
          task.preOutboxHoldState === 'AWAITING_REMOTE_ACK' &&
          task.preOutboxHoldOwner === holdOwner &&
          (task.preOutboxHoldUntil || 0) > now &&
          matchesMutation(task, mutationId)
      );
      if (!existing?.id) {
        return false;
      }
      const nextHoldUntil = now + holdForMs;
      await hospitalDB.syncQueue.update(existing.id, {
        nextAttemptAt: nextHoldUntil,
        preOutboxHoldUntil: nextHoldUntil,
        preOutboxHoldHeartbeatAt: now,
      });
      return true;
    });
  },
  async update(taskId, patch) {
    await hospitalDB.syncQueue.update(taskId, patch);
  },
  async updateClaimed(taskId, patch, claim) {
    return hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => {
      const task = await hospitalDB.syncQueue.get(taskId);
      if (!matchesClaim(task, claim)) {
        return false;
      }
      await hospitalDB.syncQueue.update(taskId, patch);
      return true;
    });
  },
  async delete(taskId) {
    await hospitalDB.syncQueue.delete(taskId);
  },
  async deleteClaimed(taskId, claim) {
    return hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => {
      const task = await hospitalDB.syncQueue.get(taskId);
      if (!matchesClaim(task, claim)) {
        return false;
      }
      await hospitalDB.syncQueue.delete(taskId);
      return true;
    });
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
