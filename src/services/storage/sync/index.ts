/**
 * Canonical sync queue entrypoint.
 *
 * This is the canonical sync queue surface.
 */

export {
  completeDirectDailyRecordSyncTask,
  ackDailyRecordSyncTask,
  adoptAuthoritativeDailyRecordAtomically,
  discardQuarantinedSyncTask,
  retryQuarantinedSyncTask,
  ensureSyncQueueOnlineListener,
  getSyncQueueDomainMetrics,
  getSyncQueueStats,
  getSyncQueueTelemetry,
  isConflictSyncError,
  isRetryableSyncError,
  listRecentSyncQueueOperations,
  processSyncQueue,
  queueDailyRecordSyncTaskWithLocalRecord,
  replacePendingDailyRecordSyncTaskWithLocalRecord,
  queueSyncTask,
  releaseDailyRecordPreOutboxHold,
  renewDailyRecordPreOutboxHold,
} from '@/services/storage/sync/publicSyncQueue';

export type {
  PendingDailyRecordSyncTaskIdentity,
  PendingDailyRecordSyncTaskSnapshot,
  SyncQueueEnqueueResult,
} from '@/services/storage/sync/syncQueuePorts';

export type {
  SyncQueueDomainMetrics,
  SyncQueueOperationSnapshot,
  SyncQueueTelemetry,
} from '@/services/storage/sync/publicSyncQueue';
