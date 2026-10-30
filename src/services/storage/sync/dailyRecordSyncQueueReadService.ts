import {
  ensureDbReady,
  hospitalDB,
  isDatabaseInFallbackMode,
} from '@/services/storage/indexeddb/indexedDbCore';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { DailyRecordQueuedWriteState, SyncTask } from '@/services/storage/syncQueueTypes';

const ACTIVE_WRITE_STATES = new Set<SyncTask['status']>(['PENDING', 'PROCESSING']);
const BLOCKED_WRITE_STATES = new Set<SyncTask['status']>(['FAILED', 'CONFLICT']);
const UNRESOLVED_WRITE_STATES = new Set([...ACTIVE_WRITE_STATES, ...BLOCKED_WRITE_STATES]);

const isDailyRecordWriteForDate = (task: SyncTask, date: string): boolean =>
  task.type === 'UPDATE_DAILY_RECORD' && task.key === `daily:${date}`;

/** Tasks keyed to the census date, through the queue's key index. */
const listDayTasks = (date: string): Promise<SyncTask[]> =>
  hospitalDB.syncQueue.where('key').equals(`daily:${date}`).toArray();

const payloadOf = (task: SyncTask) => task.payload as Partial<DailyRecord> | null | undefined;

/**
 * Whether a day write still holds the stored day's copy: until it is confirmed and leaves the
 * queue, retired by its owner as a backup, or released. A released one keeps only its own payload
 * for review: it never pins, absorbs or publishes the day.
 */
export const holdsDailyRecordProjection = (task: SyncTask, date: string): boolean =>
  isDailyRecordWriteForDate(task, date) &&
  !task.projectionReleased &&
  (task.status !== 'RETIRED' || task.retirement?.reason !== 'manual_discard');

/**
 * The day writes that hold the stored day, read in the caller's `rw` transaction over both tables.
 * A blocked write whose copy is already gone (a session closed by an older version) has no copy
 * left to keep: it is released here with its payload untouched, so the server's day can be read
 * and the next edit gets its own task. Any other write without its copy still fails closed.
 */
export const listDailyRecordProjectionHolders = async (date: string): Promise<SyncTask[]> => {
  const holders = (await listDayTasks(date)).filter(task => holdsDailyRecordProjection(task, date));
  if (
    !holders.length ||
    holders.some(
      task => !BLOCKED_WRITE_STATES.has(task.status) || payloadOf(task)?.date !== date
    ) ||
    (await hospitalDB.dailyRecords.get(date))
  ) {
    return holders;
  }
  for (const task of holders) {
    await hospitalDB.syncQueue.update(task.id!, { projectionReleased: true });
  }
  return [];
};

/** Read the pending projection after remote work finishes, even if its timestamp did not change. */
export const getPendingDailyRecordProjection = async (
  date: string
): Promise<DailyRecord | null> => {
  await ensureDbReady();
  if (isDatabaseInFallbackMode()) return null;
  return hospitalDB.transaction('rw', hospitalDB.dailyRecords, hospitalDB.syncQueue, async () => {
    if (!(await listDailyRecordProjectionHolders(date)).length) return null;
    const record = await hospitalDB.dailyRecords.get(date);
    if (!record) throw new Error('No existe la copia local de una escritura pendiente.');
    return record;
  });
};

/**
 * Detects any write for the census date that can still reach Firestore, regardless of which
 * local revision produced it. A Rayen metadata checkpoint must not race one of these tasks.
 */
export const hasUnresolvedDailyRecordWriteForDate = async (date: string): Promise<boolean> => {
  await ensureDbReady();
  // A released write still counts until its owner retires it: its edits were never published.
  return (await listDayTasks(date)).some(
    task => isDailyRecordWriteForDate(task, date) && UNRESOLVED_WRITE_STATES.has(task.status)
  );
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
  const statuses = (await listDayTasks(date))
    .filter(
      task =>
        holdsDailyRecordProjection(task, date) &&
        payloadOf(task)?.date === date &&
        payloadOf(task)?.lastUpdated === lastUpdated
    )
    .map(task => task.status);
  if (statuses.includes('CONFLICT')) return 'conflict';
  if (statuses.includes('FAILED')) return 'failed';
  return statuses.some(status => ACTIVE_WRITE_STATES.has(status)) ? 'active' : 'none';
};
