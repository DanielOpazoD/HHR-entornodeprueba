import { DataRegressionError, VersionMismatchError } from '@/utils/integrityGuard';
import {
  createSaveDailyRecordResult,
  createUpdatePartialDailyRecordResult,
  type DailyRecordWriteReason,
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

const resolveWriteOutcome = (state: RemoteWriteState): 'clean' | 'queued' | 'auto_merged' => {
  if (state.autoMerged) return 'auto_merged';
  if (state.queuedForRetry) return 'queued';
  return 'clean';
};

const resolveCompatibilityOutcome = (
  state: RemoteWriteState
): 'clean' | 'queued' | 'auto_merged' | 'blocked' | 'unrecoverable' => {
  if (
    state.consistencyState === 'blocked_regression' ||
    state.consistencyState === 'blocked_version_mismatch'
  ) {
    return 'blocked';
  }
  if (state.consistencyState === 'unrecoverable') {
    return 'unrecoverable';
  }
  return resolveWriteOutcome(state);
};

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

export const buildSaveResult = (date: string, state: RemoteWriteState) =>
  createSaveDailyRecordResult({
    date,
    outcome: resolveCompatibilityOutcome(state),
    savedLocally: state.savedLocally,
    savedRemotely: state.savedRemotely,
    queuedForRetry: state.queuedForRetry,
    autoMerged: state.autoMerged,
    consistencyState: state.consistencyState,
    conflictSummary: state.conflictSummary,
    observabilityTags: state.observabilityTags,
    reason: state.reason,
    userSafeMessage: state.userSafeMessage,
    blockingError: state.blockingError,
    confirmedRecord: state.confirmedRecord,
    localProjectionRecord: state.localProjectionRecord,
  });

export const buildPartialUpdateResult = (date: string, state: RemoteWriteState) =>
  createUpdatePartialDailyRecordResult({
    date,
    outcome: resolveCompatibilityOutcome(state),
    savedLocally: state.savedLocally,
    updatedRemotely: state.savedRemotely,
    queuedForRetry: state.queuedForRetry,
    autoMerged: state.autoMerged,
    consistencyState: state.consistencyState,
    conflictSummary: state.conflictSummary,
    observabilityTags: state.observabilityTags,
    reason: state.reason,
    userSafeMessage: state.userSafeMessage,
    blockingError: state.blockingError,
    confirmedRecord: state.confirmedRecord,
    localProjectionRecord: state.localProjectionRecord,
  });

export const buildBlockedSaveResult = (date: string, state: RemoteWriteState) =>
  createSaveDailyRecordResult({
    date,
    outcome: 'blocked',
    savedLocally: false,
    savedRemotely: false,
    queuedForRetry: false,
    autoMerged: false,
    consistencyState: state.consistencyState,
    conflictSummary: state.conflictSummary,
    observabilityTags: state.observabilityTags,
    userSafeMessage: state.userSafeMessage,
    blockingError: state.blockingError,
  });

export const buildBlockedPartialUpdateResult = (date: string, state: RemoteWriteState) =>
  createUpdatePartialDailyRecordResult({
    date,
    outcome: 'blocked',
    savedLocally: false,
    updatedRemotely: false,
    queuedForRetry: false,
    autoMerged: false,
    consistencyState: state.consistencyState,
    conflictSummary: state.conflictSummary,
    observabilityTags: state.observabilityTags,
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
