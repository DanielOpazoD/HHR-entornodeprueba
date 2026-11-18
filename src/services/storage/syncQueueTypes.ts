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
  type: 'UPDATE_DAILY_RECORD' | 'UPDATE_PATIENT' | 'ARCHIVE_CUDYR';
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
  /** Original values of granular edits, kept locally to prove a safe authority rebase. */
  patchBaseValues?: Record<string, unknown>;
  /** The day revision each of those values was read at: the copy the census showed. */
  patchBaseRevisions?: Record<string, number>;
  /** Original occupant/episode context; never renewed by compaction. */
  patchBaseContext?: Record<string, unknown>;
  /** Local projection ancestry only; these ids never acknowledge publication of another task. */
  localProjectionBaseIds?: string[];
  /**
   * The stored day no longer holds this day write's edits: a closed session cleared that copy.
   * The task keeps its payload, contract and diagnosis for its owner's review or retirement with a
   * backup. It never holds, absorbs or publishes the day again. Absent: it still holds the copy.
   */
  projectionReleased?: true;
  /** Replays only declared nursing fields from a released copy, with its original version. */
  nursingHandoffRecovery?: true;
  /** Staff identity only, for the shared-computer notice; never handoff content. */
  nursingHandoffOwnerLabel?: string;
  /**
   * The conflict this task was held in when a direct write of other fields folded into it. Once
   * the server confirms that write, the task is that conflict again: the rest of it was refused
   * as it stands, and sending it would only meet the same refusal.
   */
  conflictBeforeDirectWrite?: SyncTaskHeldConflict;
}

/** What a task held as a conflict shows for review. */
export type SyncTaskHeldConflict = Pick<
  SyncTask,
  | 'error'
  | 'lastErrorCode'
  | 'lastErrorCategory'
  | 'lastErrorSeverity'
  | 'lastErrorAction'
  | 'lastErrorAt'
>;

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
