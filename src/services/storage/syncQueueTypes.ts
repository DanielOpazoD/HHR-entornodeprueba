/**
 * Sync queue task contracts shared by storage services.
 */
import type {
  SyncDomainContext,
  SyncTaskOrigin,
} from '@/services/storage/sync/syncDomainContracts';

export interface SyncTask {
  id?: number;
  opId: string;
  type: 'UPDATE_DAILY_RECORD' | 'UPDATE_PATIENT';
  payload: unknown;
  timestamp: number;
  retryCount: number;
  nextAttemptAt?: number;
  status: 'PENDING' | 'PROCESSING' | 'FAILED' | 'CONFLICT';
  error?: string;
  lastErrorCode?: string;
  lastErrorCategory?: 'conflict' | 'authorization' | 'validation' | 'network' | 'unknown';
  lastErrorSeverity?: 'low' | 'medium' | 'high' | 'critical';
  lastErrorAction?: string;
  lastErrorAt?: number;
  key?: string;
  ownerKey?: string;
  leaseOwner?: string;
  leaseUntil?: number;
  attemptId?: string;
  processingStartedAt?: number;
  preOutboxHoldState?: 'AWAITING_REMOTE_ACK';
  preOutboxHoldOwner?: string;
  preOutboxHoldUntil?: number;
  preOutboxHoldReason?: 'awaiting_remote_ack';
  preOutboxHoldHeartbeatAt?: number;
  contexts?: SyncDomainContext[];
  origin?: SyncTaskOrigin;
  recoveryPolicy?: string;
  syncContract?: SyncTaskContract;
}

export type SyncTaskResolution =
  | 'accepted'
  | 'replayed'
  | 'merged'
  | 'blocked'
  | 'stale'
  | 'already_applied';

export interface SyncTaskContract {
  expectedVersion?: string;
  acceptedVersion?: string;
  acceptedRevision?: number;
  baseRevision?: number;
  recordRevision?: string;
  clinicalEpisodeKeys?: string[];
  changedPaths?: string[];
  mutationId?: string;
  mutationIds?: string[];
  clientId?: string;
  tabId?: string;
  resolution?: SyncTaskResolution;
}
