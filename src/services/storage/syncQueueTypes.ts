/**
 * Sync queue task contracts shared by storage services.
 */
import type {
  SyncDomainContext,
  SyncTaskOrigin,
} from '@/services/storage/sync/syncDomainContracts';
import type { SpecialistHandoffTarget } from '@/types/domain/specialistHandoffTarget';

/** One specialist callable request: the handoff fields of one bed or crib, for the patients typed for. */
export interface SpecialistHandoffSyncPayload {
  date: string;
  patch: Record<string, unknown>;
  expectedOccupants: SpecialistHandoffTarget[];
  /** The write's id: the server acknowledges a replay of a write it already took. */
  mutationId?: string;
}

export interface SyncTask {
  id?: number;
  opId: string;
  type: 'UPDATE_DAILY_RECORD' | 'UPDATE_PATIENT' | 'ARCHIVE_CUDYR' | 'UPDATE_SPECIALIST_HANDOFF';
  payload: unknown;
  timestamp: number;
  retryCount: number;
  nextAttemptAt?: number;
  status: 'PENDING' | 'PROCESSING' | 'FAILED' | 'CONFLICT' | 'RETIRED';
  /** Preserved locally, never acknowledged as remotely saved or retried automatically. */
  retirement?:
    | {
        reason: 'empty_capture_without_census_context';
        retiredAt: string;
        authorityDate: string;
        verifiedRunId: string;
      }
    | {
        reason: 'manual_discard';
        retiredAt: string;
        previousStatus: 'FAILED' | 'CONFLICT';
      };
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
  /** Local projection ancestry only; these ids never acknowledge publication of another task. */
  localProjectionBaseIds?: string[];
  /**
   * The stored day no longer holds this day write's edits: a closed session cleared that copy.
   * The task keeps its payload, contract and diagnosis for its owner's review or retirement with a
   * backup. It never holds, absorbs or publishes the day again. Absent: it still holds the copy.
   */
  projectionReleased?: true;
  /** A note's base and its projected or already-held day values, settled on refusal or ACK. */
  handoffProjection?: {
    replaced: Record<string, unknown>;
    projected: Record<string, unknown>;
    /** Refusal restored the base; keep both values for a later explicit retry and ACK. */
    released?: true;
  };
}

export type DailyRecordQueuedWriteState = 'none' | 'active' | 'failed' | 'conflict';

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
