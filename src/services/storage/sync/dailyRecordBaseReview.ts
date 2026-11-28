import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { hasNurseEditingWindowClosed } from '@/utils/clinicalWallClock';
import { canReleaseClosedWindowRefusals } from '@/shared/access/censusDayWriteAccessPolicy';

/** An unchanged retry cannot recover the remote version its writer never had. */
export const requiresDailyRecordBaseReview = (
  task: Pick<SyncTask, 'type' | 'status' | 'lastErrorCode' | 'error'>
): boolean =>
  task.type === 'UPDATE_DAILY_RECORD' &&
  (task.status === 'FAILED' || task.status === 'CONFLICT') &&
  (task.lastErrorCode === 'sync_daily_record_base_review' ||
    ((task.lastErrorCode === 'failed-precondition' ||
      task.lastErrorCode === 'functions/failed-precondition') &&
      /\bbase_required:/.test(task.error ?? '')));

const DAILY_RECORD_KEY = /^daily:(\d{4}-\d{2}-\d{2})$/;

/**
 * A census day send refused after that day's nurse editing window closed (SAVE-04). The window
 * never reopens, so no retry can succeed, and the census shows the server's day again: the edit
 * stays only in its task, for its author to review and discard with a backup. The rules path gives
 * no message of its own, so the day decides, not the error text. A missing, malformed or future day
 * proves no closure. The administrator has no window, so the server never refuses them for it.
 */
export const isClosedNurseWindowRefusal = (
  task: Pick<SyncTask, 'type' | 'key' | 'status' | 'lastErrorCode' | 'writerRole'>,
  now: number
): boolean => {
  const day = task.key?.match(DAILY_RECORD_KEY)?.[1];
  return (
    task.type === 'UPDATE_DAILY_RECORD' &&
    (task.writerRole === undefined || canReleaseClosedWindowRefusals(task.writerRole)) &&
    task.status === 'FAILED' &&
    !!day &&
    /(?:^|\/)permission-denied$/.test(task.lastErrorCode ?? '') &&
    hasNurseEditingWindowClosed(day, now)
  );
};
