/**
 * Canonical sync queue entrypoint.
 *
 * This is the canonical sync queue surface.
 */

export {
  ackDailyRecordSyncTask,
  adoptAuthoritativeDailyRecordAtomically,
  clearAllSyncQueue,
  clearSyncQueueForOwner,
  ensureSyncQueueOnlineListener,
  getPendingDailyRecordSyncTaskSnapshot,
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
  recordSyncQueueOwnershipTelemetry,
} from '@/services/storage/sync/publicSyncQueue';

export type {
  PendingDailyRecordSyncTaskIdentity,
  PendingDailyRecordSyncTaskSnapshot,
} from '@/services/storage/sync/pendingDailyRecordSyncTask';

export type { SyncQueueEnqueueResult } from '@/services/storage/sync/syncQueueEngineContracts';

export type {
  SyncQueueDomainMetrics,
  SyncQueueOperationSnapshot,
  SyncQueueTelemetry,
} from '@/services/storage/sync/publicSyncQueue';
