import { ensureDbReady, hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  captureAuthoringSession,
  isAuthoringSessionCurrent,
} from '@/services/session/authoringSession';
import { SESSION_GENERATION_KEY } from '@/services/session/sessionStorageTransition';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { deleteReviewedDailyRecordTask, matchesOwner } from './dexieSyncQueueQuarantine';

export interface DailyRecordTaskReview {
  task: SyncTask & { id: number };
  owner: string;
  generation: string;
}

export const serializeDailyRecordTaskBackup = (task: SyncTask): string =>
  JSON.stringify({ schemaVersion: 1, remotelyConfirmed: false, task }, null, 2);

const sessionMatches = (owner: string, generation: string): boolean =>
  isAuthoringSessionCurrent({ ownerKey: owner, generation }) &&
  generation === localStorage.getItem(SESSION_GENERATION_KEY);

const requireDurableDatabase = async () => {
  await ensureDbReady();
  // The memory fallback has no bound Dexie table; a runtime flag alone is not proof.
  if (hospitalDB.syncQueue.db !== hospitalDB) throw new Error('La base local no está disponible.');
};

const isWholeDayTask = (task: SyncTask): boolean => {
  const payload = task.payload;
  return (
    task.type === 'UPDATE_DAILY_RECORD' &&
    typeof payload === 'object' &&
    payload !== null &&
    'date' in payload &&
    typeof payload.date === 'string' &&
    task.key === `daily:${payload.date}`
  );
};

/** Capture the actual blocked send when its confirmation opens, including its original payload. */
export const reviewBlockedDailyRecordTask = async (
  taskId: number
): Promise<DailyRecordTaskReview | null> => {
  const { ownerKey: owner, generation } = captureAuthoringSession();
  if (!owner || !generation || !sessionMatches(owner, generation)) return null;
  await requireDurableDatabase();
  const task = await hospitalDB.syncQueue.get(taskId);
  if (
    !sessionMatches(owner, generation) ||
    !task ||
    !matchesOwner(owner, task.ownerKey) ||
    !isWholeDayTask(task) ||
    (task.status !== 'FAILED' && task.status !== 'CONFLICT')
  )
    return null;
  return { task: { ...task, id: taskId }, owner, generation };
};

/** Confirmed discard: deletes the blocked send from the local queue (never a remote ACK). */
export const retireReviewedDailyRecordTask = async (
  review: DailyRecordTaskReview
): Promise<boolean> => {
  await requireDurableDatabase();
  return deleteReviewedDailyRecordTask(
    review.task.id,
    JSON.stringify(review.task),
    review.owner,
    isWholeDayTask,
    () => sessionMatches(review.owner, review.generation)
  );
};

export const getDailyRecordReviewBackup = async (
  review: DailyRecordTaskReview
): Promise<string | null> => {
  if (!sessionMatches(review.owner, review.generation)) return null;
  const current = await reviewBlockedDailyRecordTask(review.task.id);
  return current && JSON.stringify(current) === JSON.stringify(review)
    ? serializeDailyRecordTaskBackup(review.task)
    : null;
};
