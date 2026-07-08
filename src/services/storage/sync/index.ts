/**
 * Canonical sync queue entrypoint.
 *
 * This is the canonical sync queue surface.
 */

export {
  ackDailyRecordSyncTask,
  clearAllSyncQueue,
  clearSyncQueueForOwner,
  ensureSyncQueueOnlineListener,
  getSyncQueueDomainMetrics,
  getSyncQueueStats,
  getSyncQueueTelemetry,
  isConflictSyncError,
  isRetryableSyncError,
  listRecentSyncQueueOperations,
  processSyncQueue,
  queueDailyRecordSyncTaskWithLocalRecord,
  queueSyncTask,
  releaseDailyRecordPreOutboxHold,
  renewDailyRecordPreOutboxHold,
  recordSyncQueueOwnershipTelemetry,
} from '@/services/storage/sync/publicSyncQueue';

export type { SyncQueueEnqueueResult } from '@/services/storage/sync/syncQueueEngineContracts';

export type {
  SyncQueueDomainMetrics,
  SyncQueueOperationSnapshot,
  SyncQueueTelemetry,
} from '@/services/storage/sync/publicSyncQueue';
