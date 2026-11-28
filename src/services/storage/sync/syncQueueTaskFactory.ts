import type { SyncQueueLeaseClaim } from '@/services/storage/sync/syncQueuePorts';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

export const matchesTaskClaim = (
  task: SyncTask | undefined,
  claim: SyncQueueLeaseClaim
): task is SyncTask =>
  Boolean(
    task &&
    task.status === 'PROCESSING' &&
    task.leaseOwner === claim.leaseOwner &&
    task.attemptId === claim.attemptId
  );

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
  preOutboxHoldState: undefined,
  preOutboxHoldOwner: undefined,
  preOutboxHoldUntil: undefined,
  preOutboxHoldReason: undefined,
  preOutboxHoldHeartbeatAt: undefined,
  conflictBeforeDirectWrite: undefined,
});

/** What logout leaves on an unsent task: blocked, kept for review by its original owner. */
export const sessionClosedTaskState = () => ({
  ...clearSyncTaskRuntimeState(),
  status: 'FAILED' as const,
  error: 'Sesión cerrada. Revisa los cambios pendientes con su usuario original.',
  lastErrorCode: 'session_owner_logged_out',
  lastErrorCategory: 'authorization' as const,
  lastErrorSeverity: 'medium' as const,
  lastErrorAction: 'review_owned_pending_changes',
});

export const getSyncTaskKey = (type: SyncTask['type'], payload: unknown): string | undefined => {
  if (type === 'ARCHIVE_CUDYR') {
    const id = (payload as { id?: string })?.id;
    return id && /^[a-f0-9-]{36}$/.test(id) ? `cudyr:${id}` : undefined;
  }
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

export const buildTaskClaim = (task: SyncTask): SyncQueueLeaseClaim | null => {
  if (!task.leaseOwner || !task.attemptId || !task.leaseUntil) {
    return null;
  }
  return {
    leaseOwner: task.leaseOwner,
    leaseUntil: task.leaseUntil,
    attemptId: task.attemptId,
  };
};

export interface SyncQueueOperationSnapshot {
  id?: number;
  type: SyncTask['type'];
  status: SyncTask['status'];
  retryCount: number;
  timestamp: number;
  nextAttemptAt?: number;
  error?: string;
  lastErrorCode?: SyncTask['lastErrorCode'];
  lastErrorCategory?: SyncTask['lastErrorCategory'];
  lastErrorSeverity?: SyncTask['lastErrorSeverity'];
  lastErrorAction?: SyncTask['lastErrorAction'];
  lastErrorAt?: SyncTask['lastErrorAt'];
  key?: string;
  writerRole?: SyncTask['writerRole'];
  leaseOwner?: SyncTask['leaseOwner'];
  leaseUntil?: SyncTask['leaseUntil'];
  attemptId?: SyncTask['attemptId'];
  processingStartedAt?: SyncTask['processingStartedAt'];
  preOutboxHoldState?: SyncTask['preOutboxHoldState'];
  preOutboxHoldOwner?: SyncTask['preOutboxHoldOwner'];
  preOutboxHoldUntil?: SyncTask['preOutboxHoldUntil'];
  preOutboxHoldReason?: SyncTask['preOutboxHoldReason'];
  preOutboxHoldHeartbeatAt?: SyncTask['preOutboxHoldHeartbeatAt'];
  contexts?: SyncTask['contexts'];
  origin?: SyncTask['origin'];
  recoveryPolicy?: SyncTask['recoveryPolicy'];
  syncContract?: SyncTask['syncContract'];
  projectionReleased?: SyncTask['projectionReleased'];
}

export const toSyncQueueOperationSnapshot = (row: SyncTask): SyncQueueOperationSnapshot => ({
  id: row.id,
  type: row.type,
  status: row.status,
  retryCount: row.retryCount,
  timestamp: row.timestamp,
  nextAttemptAt: row.nextAttemptAt,
  error: row.error,
  lastErrorCode: row.lastErrorCode,
  lastErrorCategory: row.lastErrorCategory,
  lastErrorSeverity: row.lastErrorSeverity,
  lastErrorAction: row.lastErrorAction,
  lastErrorAt: row.lastErrorAt,
  key: row.key,
  writerRole: row.writerRole,
  leaseOwner: row.leaseOwner,
  leaseUntil: row.leaseUntil,
  attemptId: row.attemptId,
  processingStartedAt: row.processingStartedAt,
  preOutboxHoldState: row.preOutboxHoldState,
  preOutboxHoldOwner: row.preOutboxHoldOwner,
  preOutboxHoldUntil: row.preOutboxHoldUntil,
  preOutboxHoldReason: row.preOutboxHoldReason,
  preOutboxHoldHeartbeatAt: row.preOutboxHoldHeartbeatAt,
  contexts: row.contexts,
  origin: row.origin,
  recoveryPolicy: row.recoveryPolicy,
  syncContract: sanitizeSyncContractForOperationalSnapshot(row.syncContract),
  projectionReleased: row.projectionReleased,
});
