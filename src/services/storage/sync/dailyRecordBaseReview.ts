import type { SyncTask } from '@/services/storage/syncQueueTypes';

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
