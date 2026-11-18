import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { dispatchDailyRecordStoreChanged } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { isClosedNurseWindowRefusal } from './dailyRecordBaseReview';

/**
 * SAVE-04 after the window: this person's census day sends the server refused once the nurse window
 * of their day had closed never reach it. Each one is released as logout releases it
 * (`projectionReleased`, already read by every version) and nothing else changes: the task keeps
 * its payload, for its author to download and discard, and the stored day is not written here.
 * The `release` notice drops the send's unconfirmed overlay and has the census read the day again;
 * that read decides what is shown (`composeServerDayWithPending`), where a released send adds
 * nothing. Run after every queue pass, so a refusal judged while this computer's clock was behind
 * is released once the clock is right.
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
