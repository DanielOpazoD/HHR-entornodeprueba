import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { matchesTaskClaim } from '@/services/storage/sync/syncQueueTaskFactory';
import { listUnresolvedDailyRecordTasks } from '@/services/storage/sync/dexieSyncQueueQuarantine';
import type { SyncQueueLeaseClaim } from '@/services/storage/sync/syncQueuePorts';

const shouldAdoptDailyRecordAck = (
  task: SyncTask,
  authoritativeRecord: DailyRecord,
  local: DailyRecord | undefined,
  hasUnresolvedWrites: boolean
): boolean => {
  const payload = task.payload as Partial<DailyRecord> | undefined;
  if (
    task.type !== 'UPDATE_DAILY_RECORD' ||
    task.key !== `daily:${authoritativeRecord.date}` ||
    payload?.date !== authoritativeRecord.date
  ) {
    throw new ConcurrencyError('ACK record mismatch.');
  }
  if (hasUnresolvedWrites) {
    if (!local) {
      throw new ConcurrencyError('Missing local projection.');
    }
    return false;
  }
  if (
    local &&
    local.lastUpdated !== payload.lastUpdated &&
    local.lastUpdated !== authoritativeRecord.lastUpdated
  ) {
    throw new ConcurrencyError('ACK version conflict.');
  }
  return true;
};

export const completeClaimedSyncTask = (
  taskId: number,
  claim: SyncQueueLeaseClaim,
  authoritativeRecord?: DailyRecord
): Promise<{ deleted: boolean; adopted: boolean }> =>
  hospitalDB.transaction('rw', hospitalDB.syncQueue, hospitalDB.dailyRecords, async () => {
    const task = await hospitalDB.syncQueue.get(taskId);
    if (!matchesTaskClaim(task, claim)) return { deleted: false, adopted: false };
    let adopted = false;
    if (authoritativeRecord) {
      const unresolved = (await listUnresolvedDailyRecordTasks(authoritativeRecord.date)).some(
        candidate => candidate.id !== taskId
      );
      const local = await hospitalDB.dailyRecords.get(authoritativeRecord.date);
      adopted = shouldAdoptDailyRecordAck(task, authoritativeRecord, local, unresolved);
      if (adopted) await hospitalDB.dailyRecords.put(authoritativeRecord);
    }
    await hospitalDB.syncQueue.delete(taskId);
    return { deleted: true, adopted };
  });
