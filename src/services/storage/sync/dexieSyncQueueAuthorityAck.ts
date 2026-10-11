import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import type { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import type { matchesTaskClaim } from '@/services/storage/sync/syncQueueTaskFactory';
import type { listUnresolvedDailyRecordTasks } from '@/services/storage/sync/dexieSyncQueueQuarantine';
import type { SyncQueueLeaseClaim } from '@/services/storage/sync/syncQueuePorts';

interface AckRuntime {
  db: typeof hospitalDB;
  matchesClaim: typeof matchesTaskClaim;
  pending: typeof listUnresolvedDailyRecordTasks;
  conflict: typeof ConcurrencyError;
}

const shouldAdoptDailyRecordAck = (
  task: SyncTask,
  authoritativeRecord: DailyRecord,
  local: DailyRecord | undefined,
  hasUnresolvedWrites: boolean,
  ConflictError: typeof ConcurrencyError
): boolean => {
  const payload = task.payload as Partial<DailyRecord> | undefined;
  if (
    task.type !== 'UPDATE_DAILY_RECORD' ||
    task.key !== `daily:${authoritativeRecord.date}` ||
    payload?.date !== authoritativeRecord.date
  ) {
    throw new ConflictError('ACK record mismatch.');
  }
  if (hasUnresolvedWrites) {
    if (!local) {
      throw new ConflictError('Missing local projection.');
    }
    return false;
  }
  if (
    local &&
    local.lastUpdated !== payload.lastUpdated &&
    local.lastUpdated !== authoritativeRecord.lastUpdated
  ) {
    throw new ConflictError('ACK version conflict.');
  }
  return true;
};

export const completeClaimedSyncTask = (
  { db, matchesClaim, pending, conflict }: AckRuntime,
  taskId: number,
  claim: SyncQueueLeaseClaim,
  authoritativeRecord?: DailyRecord
): Promise<{ deleted: boolean; adopted: boolean }> =>
  db.transaction('rw', db.syncQueue, db.dailyRecords, async () => {
    const task = await db.syncQueue.get(taskId);
    if (!matchesClaim(task, claim)) return { deleted: false, adopted: false };
    let adopted = false;
    if (authoritativeRecord) {
      const unresolved = (await pending(authoritativeRecord.date)).some(
        candidate => candidate.id !== taskId
      );
      const local = await db.dailyRecords.get(authoritativeRecord.date);
      adopted = shouldAdoptDailyRecordAck(task, authoritativeRecord, local, unresolved, conflict);
      if (adopted) await db.dailyRecords.put(authoritativeRecord);
    }
    await db.syncQueue.delete(taskId);
    return { deleted: true, adopted };
  });
