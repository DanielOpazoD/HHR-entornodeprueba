import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { dispatchDailyRecordStoreChanged } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import {
  getValueAtPath,
  hasSameComparableValue,
} from '@/services/repositories/conflictResolutionUtils';
import { isSameEpisodeForExplicitCensusPatch } from '@/services/repositories/explicitLocalCensusPatchPolicy';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { applyPatches } from '@/utils/patchUtils';
import { isClosedNurseWindowRefusal } from './dailyRecordBaseReview';
import { pathsOverlap } from './dayTaskReplayGuard';
import { holdsDailyRecordProjection } from './dexieSyncQueueQuarantine';

const changedPathsOf = (task: SyncTask): string[] =>
  task.syncContract?.changedPaths?.length ? task.syncContract.changedPaths : ['*'];

/** A bed field goes back only while the bed still shows the episode this write was made for (ID-01). */
const sameOccupant = (stored: DailyRecord, payload: DailyRecord, path: string): boolean => {
  const [root, bedId] = path.split('.');
  if (root !== 'beds') return true;
  return (
    bedId !== undefined &&
    isSameEpisodeForExplicitCensusPatch(stored.beds?.[bedId], payload.beds?.[bedId])
  );
};

/**
 * The stored day without a released write's own values. Each field it changed goes back to the
 * value it was written over, kept in the task (`patchBaseValues`), while the day still shows this
 * write's value. A field another write holding the day also changed stays as that write left it,
 * and a field without a kept base stays until the next server read. The rest of the day, and the
 * task, are untouched.
 */
const withoutReleasedValues = (
  task: SyncTask,
  stored: DailyRecord,
  others: SyncTask[]
): { record: DailyRecord; paths: string[] } => {
  const payload = task.payload as DailyRecord;
  const othersChanged = others.flatMap(changedPathsOf);
  const paths = changedPathsOf(task).filter(
    path =>
      path !== '*' &&
      !othersChanged.some(other => other === '*' || pathsOverlap(other, path)) &&
      sameOccupant(stored, payload, path)
  );
  const bases = task.patchBaseValues ?? {};
  const restore = Object.fromEntries(
    paths
      .filter(
        path =>
          Object.hasOwn(bases, path) &&
          hasSameComparableValue(getValueAtPath(stored, path), getValueAtPath(payload, path))
      )
      .map(path => [path, bases[path]])
  ) as DailyRecordPatch;
  return {
    record: Object.keys(restore).length ? applyPatches(stored, restore) : stored,
    paths,
  };
};

/** Releases one stopped day write, checked again in the transaction that changes it. */
const releaseOne = (
  taskId: number,
  ownerKey: string,
  now: number
): Promise<{ date: string; paths: string[] } | null> =>
  hospitalDB.transaction('rw', hospitalDB.dailyRecords, hospitalDB.syncQueue, async () => {
    const task = await hospitalDB.syncQueue.get(taskId);
    const date = (task?.payload as { date?: unknown } | null | undefined)?.date;
    if (
      !task ||
      task.ownerKey !== ownerKey ||
      task.projectionReleased ||
      typeof date !== 'string' ||
      !isClosedNurseWindowRefusal(task, now)
    )
      return null;
    await hospitalDB.syncQueue.update(taskId, { projectionReleased: true });
    const stored = await hospitalDB.dailyRecords.get(date);
    if (!stored) return { date, paths: [] };
    const others = (
      await hospitalDB.syncQueue.where('key').equals(`daily:${date}`).toArray()
    ).filter(other => other.id !== taskId && holdsDailyRecordProjection(other, date));
    const { record, paths } = withoutReleasedValues(task, stored, others);
    if (record !== stored) await hospitalDB.dailyRecords.put(record);
    return { date, paths };
  });

/**
 * SAVE-04 after the window: this person's census day sends the server refused once the nurse window
 * of their day had closed never reach it, so the census shows what the server has. Each one is
 * released as logout releases it (`projectionReleased`, already read by every version): it stays in
 * the queue with its payload, for its author to download and discard, and the stored day gets back
 * the values it was written over. Run after every queue pass, so a refusal judged while this
 * computer's clock was behind is released once the clock is right. `mayRelease` asks for the role
 * only when there is something to release.
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
    const done = candidate.id === undefined ? null : await releaseOne(candidate.id, ownerKey, now);
    if (!done) continue;
    released.push(done.date);
    dispatchDailyRecordStoreChanged({
      operation: 'release',
      dates: [done.date],
      paths: done.paths,
    });
  }
  return released;
};
