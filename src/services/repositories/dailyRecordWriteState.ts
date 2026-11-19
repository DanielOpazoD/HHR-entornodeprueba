import { DataRegressionError, VersionMismatchError } from '@/utils/integrityGuard';
import type {
  DailyRecordWriteReason,
  DailyRecordWriteResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecordRecoveryDecision } from '@/services/repositories/contracts/dailyRecordWriteRecoveryResult';
import type { DailyRecord } from '@/types/domain/dailyRecord';

export interface RemoteWriteState {
  savedLocally: boolean;
  savedRemotely: boolean;
  queuedForRetry: boolean;
  autoMerged: boolean;
  consistencyState:
    | 'persisted_local_only'
    | 'persisted_and_synced'
    | 'queued_for_retry'
    | 'auto_merged'
    | 'blocked_regression'
    | 'blocked_version_mismatch'
    | 'blocked_validation'
    | 'unrecoverable';
  conflictSummary: DailyRecordRecoveryDecision['conflictSummary'];
  observabilityTags: string[];
  /** Set by the producer that held or routed the write; the result's state is derived from it. */
  reason?: DailyRecordWriteReason;
  userSafeMessage?: string;
  blockingError?: Error;
  confirmedRecord?: DailyRecord;
  localProjectionRecord?: DailyRecord;
}

export const createRemoteWriteState = (): RemoteWriteState => ({
  savedLocally: false,
  savedRemotely: false,
  queuedForRetry: false,
  autoMerged: false,
  consistencyState: 'persisted_local_only',
  conflictSummary: null,
  observabilityTags: ['daily_record', 'write', 'local_only'],
});

export const applyRecoveryDecisionToState = (
  state: RemoteWriteState,
  decision: DailyRecordRecoveryDecision,
  blockingError?: Error
): void => {
  state.consistencyState = decision.consistencyState;
  state.conflictSummary = decision.conflictSummary;
  state.observabilityTags = decision.observabilityTags;
  state.reason = decision.reason;
  state.userSafeMessage = decision.userSafeMessage;
  state.blockingError = blockingError;
};

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Where a write ended up: whether a copy stayed here, its state and that state's detail. */
type WriteOutcome = DistributiveOmit<
  DailyRecordWriteResult,
  | 'date'
  | 'userSafeMessage'
  | 'blockingError'
  | 'concurrencyConflict'
  | 'confirmedRecord'
  | 'localProjectionRecord'
>;

/** The only derivation of what a write left: every result leaves the repository through it. */
const resolveWriteState = (state: RemoteWriteState): WriteOutcome => {
  const savedHere = state.savedLocally;
  if (state.reason === 'session_changed') {
    return savedHere
      ? { savedHere, state: 'held', reason: 'session_changed' }
      : { savedHere, state: 'not_saved', reason: 'session_changed' };
  }
  if (state.reason === 'queue_route') return { savedHere, state: 'local', cause: 'queue_route' };
  if (state.reason === 'field_changed_elsewhere') {
    return { savedHere, state: 'held', reason: 'field_changed_elsewhere' };
  }
  if (
    state.consistencyState === 'blocked_regression' ||
    state.consistencyState === 'blocked_version_mismatch' ||
    state.consistencyState === 'blocked_validation'
  ) {
    return { savedHere, state: 'not_saved', reason: 'blocked' };
  }
  const unrecoverable = state.consistencyState === 'unrecoverable';
  if (state.savedRemotely) {
    return { savedHere, state: 'confirmed', localCopy: unrecoverable ? 'stale' : 'current' };
  }
  if (unrecoverable) {
    return savedHere
      ? { savedHere, state: 'held', reason: 'needs_review' }
      : { savedHere, state: 'not_saved', reason: 'local_failed' };
  }
  if (state.autoMerged) return { savedHere, state: 'local', cause: 'merged' };
  if (state.queuedForRetry) return { savedHere, state: 'local', cause: 'retrying' };
  return { savedHere, state: 'local', cause: 'stored' };
};

const withConcurrencyConflict = (state: RemoteWriteState) =>
  state.conflictSummary?.kind === 'concurrency' ? { concurrencyConflict: true as const } : {};

/** What a full save or a partial update returns once the repository finished with it. */
export const buildWriteResult = (
  date: string,
  state: RemoteWriteState
): DailyRecordWriteResult => ({
  date,
  ...resolveWriteState(state),
  ...withConcurrencyConflict(state),
  userSafeMessage: state.userSafeMessage,
  blockingError: state.blockingError,
  confirmedRecord: state.confirmedRecord,
  localProjectionRecord: state.localProjectionRecord,
});

/** A write stopped before anything was stored: not on this computer nor on the server. */
export const buildBlockedWriteResult = (
  date: string,
  state: RemoteWriteState
): DailyRecordWriteResult => ({
  date,
  savedHere: false,
  state: 'not_saved',
  reason: 'blocked',
  ...withConcurrencyConflict(state),
  userSafeMessage: state.userSafeMessage,
  blockingError: state.blockingError,
});

/**
 * Clasifica un error de integridad bloqueante de un guardado completo
 * (regresión, versión o validación de fecha de ingreso) y lo aplica al estado.
 */
export const applyBlockedSaveRecoveryToState = (state: RemoteWriteState, err: Error): void => {
  const blockedKind =
    err instanceof DataRegressionError
      ? 'regression'
      : err instanceof VersionMismatchError
        ? 'version_mismatch'
        : 'validation';
  applyRecoveryDecisionToState(
    state,
    {
      consistencyState:
        blockedKind === 'regression'
          ? 'blocked_regression'
          : blockedKind === 'version_mismatch'
            ? 'blocked_version_mismatch'
            : 'blocked_validation',
      conflictSummary: {
        kind:
          blockedKind === 'regression'
            ? 'regression_blocked'
            : blockedKind === 'version_mismatch'
              ? 'version_mismatch'
              : 'validation_blocked',
        sourceOfTruth: 'none',
        message: err.message,
      },
      observabilityTags: [
        'daily_record',
        'write',
        blockedKind === 'regression'
          ? 'regression_blocked'
          : blockedKind === 'version_mismatch'
            ? 'version_mismatch'
            : 'validation_blocked',
      ],
      userSafeMessage: err.message,
    },
    err
  );
};
