import { ensureDbReady, hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { DailyRecordQueuedWriteState, SyncTask } from '@/services/storage/syncQueueTypes';

const ACTIVE_WRITE_STATES = new Set<SyncTask['status']>(['PENDING', 'PROCESSING']);

const isExactDailyRecordVersion = (task: SyncTask, date: string, lastUpdated: string): boolean => {
  if (task.type !== 'UPDATE_DAILY_RECORD' || task.key !== `daily:${date}`) {
    return false;
  }

  const payload = task.payload as Partial<DailyRecord> | null | undefined;
  return payload?.date === date && payload.lastUpdated === lastUpdated;
};

/**
 * Describes the outbox state for the exact local version. Failed/conflicted versions are not safe
 * structural input, but they must remain visible so the caller cannot overwrite unresolved edits.
 */
export const getDailyRecordWriteStateForVersion = async (
  date: string,
  lastUpdated: string
): Promise<DailyRecordQueuedWriteState> => {
  await ensureDbReady();
  const tasks = await hospitalDB.syncQueue.where('type').equals('UPDATE_DAILY_RECORD').toArray();
  const statuses = tasks
    .filter(task => isExactDailyRecordVersion(task, date, lastUpdated))
    .map(task => task.status);
  if (statuses.includes('CONFLICT')) return 'conflict';
  if (statuses.includes('FAILED')) return 'failed';
  return statuses.some(status => ACTIVE_WRITE_STATES.has(status)) ? 'active' : 'none';
};
