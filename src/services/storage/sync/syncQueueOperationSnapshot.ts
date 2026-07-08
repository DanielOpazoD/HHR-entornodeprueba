import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { sanitizeSyncContractForOperationalSnapshot } from '@/services/storage/sync/syncQueueTaskFactory';

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
});
