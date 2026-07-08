import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

export const createSyncQueueWorkerId = (): string =>
  `sync_worker_${Math.random().toString(36).slice(2)}`;

export const createSyncQueueAttemptId = (): string =>
  `sync_attempt_${Date.now()}_${Math.random().toString(36).slice(2)}`;

export const clearSyncTaskRuntimeState = () => ({
  status: 'PENDING' as const,
  nextAttemptAt: 0,
  error: undefined,
  lastErrorCode: undefined,
  lastErrorCategory: undefined,
  lastErrorSeverity: undefined,
  lastErrorAction: undefined,
  lastErrorAt: undefined,
  leaseOwner: undefined,
  leaseUntil: undefined,
  attemptId: undefined,
  processingStartedAt: undefined,
  preOutboxHoldOwner: undefined,
  preOutboxHoldUntil: undefined,
  preOutboxHoldReason: undefined,
});

export const getSyncTaskKey = (type: SyncTask['type'], payload: unknown): string | undefined => {
  if (type === 'UPDATE_DAILY_RECORD') {
    const record = payload as DailyRecord;
    return record?.date ? `daily:${record.date}` : undefined;
  }

  return undefined;
};

export const anonymizeSyncActorId = (value: unknown): string | undefined => {
  const text = String(value || '').trim();
  if (!text) return undefined;

  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `anon_${(hash >>> 0).toString(36)}`;
};

export const sanitizeSyncContractForOperationalSnapshot = (
  syncContract: SyncTask['syncContract']
): SyncTask['syncContract'] | undefined => {
  if (!syncContract) return undefined;
  return {
    expectedVersion: syncContract.expectedVersion,
    acceptedVersion: syncContract.acceptedVersion,
    acceptedRevision: syncContract.acceptedRevision,
    recordRevision: syncContract.recordRevision,
    baseRevision: syncContract.baseRevision,
    changedPaths: syncContract.changedPaths,
    mutationId: syncContract.mutationId,
    mutationIds: syncContract.mutationIds,
    clientId: anonymizeSyncActorId(syncContract.clientId),
    tabId: anonymizeSyncActorId(syncContract.tabId),
    resolution: syncContract.resolution,
  };
};
