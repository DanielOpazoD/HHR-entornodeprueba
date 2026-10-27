import { ensureDbReady, hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import {
  getSessionGeneration,
  SESSION_GENERATION_KEY,
} from '@/services/storage/sessionStorageTransition';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { matchesOwner } from './dexieSyncQueueQuarantine';

export interface DailyRecordTaskReview {
  task: SyncTask & { id: number };
  owner: string;
  generation: string;
}

const sessionMatches = (owner: string, generation: string): boolean =>
  owner === getStoredSessionOwnerKey() &&
  generation === getSessionGeneration() &&
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
  const owner = getStoredSessionOwnerKey();
  const generation = getSessionGeneration();
  if (!owner || !generation) return null;
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

/** A confirmed withdrawal, never a remote ACK. The same row becomes the recoverable backup. */
export const retireReviewedDailyRecordTask = async (
  review: DailyRecordTaskReview
): Promise<boolean> => {
  await requireDurableDatabase();
  return hospitalDB.transaction('rw', hospitalDB.syncQueue, async () => {
    if (!sessionMatches(review.owner, review.generation)) return false;
    const task = await hospitalDB.syncQueue.get(review.task.id);
    if (
      !task ||
      !matchesOwner(review.owner, task.ownerKey) ||
      !isWholeDayTask(task) ||
      (task.status !== 'FAILED' && task.status !== 'CONFLICT') ||
      JSON.stringify(task) !== JSON.stringify(review.task)
    )
      return false;
    await hospitalDB.syncQueue.update(review.task.id, {
      status: 'RETIRED',
      ownerKey: review.owner,
      retirement: {
        reason: 'manual_discard',
        retiredAt: new Date().toISOString(),
        previousStatus: task.status,
      },
    });
    if (!sessionMatches(review.owner, review.generation)) throw new Error('La sesión cambió.');
    return true;
  });
};

/** Backups are read only on demand, scoped to the current session, and never requeued. */
export const listDiscardedDailyRecordTasks = async (): Promise<SyncTask[]> => {
  const owner = getStoredSessionOwnerKey();
  const generation = getSessionGeneration();
  if (!owner || !generation) return [];
  await requireDurableDatabase();
  const rows = await hospitalDB.syncQueue
    .where('status')
    .equals('RETIRED')
    .filter(
      task =>
        task.ownerKey === owner &&
        task.retirement?.reason === 'manual_discard' &&
        isWholeDayTask(task)
    )
    .toArray();
  if (!sessionMatches(owner, generation)) throw new Error('La sesión cambió.');
  return rows;
};

export const getDiscardedDailyRecordBackup = async (taskId: number): Promise<string | null> => {
  const task = (await listDiscardedDailyRecordTasks()).find(row => row.id === taskId);
  return task
    ? JSON.stringify({ schemaVersion: 1, remotelyConfirmed: false, task }, null, 2)
    : null;
};

export const getDailyRecordReviewBackup = async (
  review: DailyRecordTaskReview
): Promise<string | null> => {
  if (!sessionMatches(review.owner, review.generation)) return null;
  const current = await reviewBlockedDailyRecordTask(review.task.id);
  return current && JSON.stringify(current) === JSON.stringify(review)
    ? JSON.stringify({ schemaVersion: 1, remotelyConfirmed: false, task: review.task }, null, 2)
    : null;
};
