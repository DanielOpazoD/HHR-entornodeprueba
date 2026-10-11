import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import type { matchesTaskClaim } from '@/services/storage/sync/syncQueueTaskFactory';
import type { listUnresolvedDailyRecordTasks } from '@/services/storage/sync/dexieSyncQueueQuarantine';
import type { SyncQueueLeaseClaim } from '@/services/storage/sync/syncQueuePorts';

interface AckRuntime {
  db: typeof hospitalDB;
  matchesClaim: typeof matchesTaskClaim;
  pending: typeof listUnresolvedDailyRecordTasks;
}

class SyncQueueAckError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'SyncQueueAckError';
  }
}

export const completeClaimedSyncTask = (
  { db, matchesClaim, pending }: AckRuntime,
  taskId: number,
  claim: SyncQueueLeaseClaim,
  authoritativeRecord?: DailyRecord
): Promise<{ deleted: boolean; adopted: boolean }> =>
  db.transaction('rw', db.syncQueue, db.dailyRecords, async () => {
    const task = await db.syncQueue.get(taskId);
    if (!matchesClaim(task, claim)) return { deleted: false, adopted: false };
    let adopted = false;
    if (authoritativeRecord) {
      const payload = task.payload as Partial<DailyRecord> | undefined;
      if (
        task.type !== 'UPDATE_DAILY_RECORD' ||
        task.key !== `daily:${authoritativeRecord.date}` ||
        payload?.date !== authoritativeRecord.date
      )
        throw new SyncQueueAckError('sync_ack_invalid_record', 'Invalid ACK record.');
      const local = await db.dailyRecords.get(authoritativeRecord.date);
      const unresolved = (await pending(authoritativeRecord.date)).some(
        candidate => candidate.id !== taskId
      );
      if (unresolved) {
        if (!local)
          throw new SyncQueueAckError('sync_ack_missing_projection', 'Missing local projection.');
      } else {
        if (
          local &&
          local.lastUpdated !== payload.lastUpdated &&
          local.lastUpdated !== authoritativeRecord.lastUpdated
        )
          throw new SyncQueueAckError('sync_ack_projection_conflict', 'ACK version conflict.');
        await db.dailyRecords.put(authoritativeRecord);
        adopted = true;
      }
    }
    await db.syncQueue.delete(taskId);
    return { deleted: true, adopted };
  });
