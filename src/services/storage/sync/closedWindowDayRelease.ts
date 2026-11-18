import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { dispatchDailyRecordStoreChanged } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { isClosedNurseWindowRefusal } from './dailyRecordBaseReview';
import { holdsDailyRecordProjection } from './dexieSyncQueueQuarantine';

/** Puts the paths of the writes still holding a day on top of the server's version of it. */
export type PendingPathsOverRemote = (remote: DailyRecord, holders: SyncTask[]) => DailyRecord;

/**
 * SAVE-04 after the window: this person's census day sends the server refused once the nurse window
 * of their day had closed never reach it. Each one is released as logout releases it
 * (`projectionReleased`, already read by every version) and nothing else changes: the task keeps
 * its payload, for its author to download and discard, and the stored day is not written here.
 * The `release` notice drops the send's unconfirmed overlay and has the census read the day again;
 * that read decides what is shown (`composeOverReleasedDay`). Run after every queue pass, so a
 * refusal judged while this computer's clock was behind is released once the clock is right.
 * `mayRelease` checks the session and its role only when there is something to release.
 */
export const releaseClosedWindowRefusals = async (
  ownerKey: string,
  now: number,
  mayRelease: () => Promise<boolean>
): Promise<string[]> => {
  const candidates = (
    await hospitalDB.syncQueue.where('[ownerKey+status]').equals([ownerKey, 'FAILED']).toArray()
  ).filter(task => !task.projectionReleased && isClosedNurseWindowRefusal(task, now));
  if (!candidates.length || !(await mayRelease())) return [];
  const released: string[] = [];
  for (const candidate of candidates) {
    if (candidate.id === undefined) continue;
    const task = await hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => {
      const current = await hospitalDB.syncQueue.get(candidate.id!);
      if (
        !current ||
        current.ownerKey !== ownerKey ||
        current.projectionReleased ||
        !isClosedNurseWindowRefusal(current, now)
      )
        return null;
      await hospitalDB.syncQueue.update(candidate.id!, { projectionReleased: true });
      return current;
    });
    const date = (task?.payload as { date?: unknown } | null | undefined)?.date;
    if (!task || typeof date !== 'string') continue;
    released.push(date);
    dispatchDailyRecordStoreChanged({
      operation: 'release',
      dates: [date],
      paths: (task.syncContract?.changedPaths ?? []).filter(path => path !== '*'),
    });
  }
  return released;
};

/**
 * The day a successful server read shows while other writes still hold it and a released one may
 * have left its values in the stored copy: the server's version with the paths of the writes that
 * still hold it, never those of a released one. Read in the caller's `rw` transaction. The stored
 * copy stays as it is (`kept`) when no released write exists for the day, or when the holders
 * cannot be put on top (a write without its paths, or a bed that changed patient). A composed day
 * keeps the stored copy's version, the one its holders were written against.
 */
export const composeOverReleasedDay = async (
  date: string,
  remote: DailyRecord,
  stored: DailyRecord,
  compose: PendingPathsOverRemote
): Promise<{ record: DailyRecord } | { kept: 'no_released_send' | 'not_composable' }> => {
  const tasks = await hospitalDB.syncQueue.where('key').equals(`daily:${date}`).toArray();
  if (!tasks.some(task => task.projectionReleased && task.status !== 'RETIRED'))
    return { kept: 'no_released_send' };
  const holders = tasks
    .filter(task => holdsDailyRecordProjection(task, date))
    .sort((left, right) => (left.id ?? 0) - (right.id ?? 0));
  try {
    return { record: { ...compose(remote, holders), lastUpdated: stored.lastUpdated } };
  } catch {
    // The holders' paths cannot be placed on the server's day: they keep the stored copy.
    return { kept: 'not_composable' };
  }
};
