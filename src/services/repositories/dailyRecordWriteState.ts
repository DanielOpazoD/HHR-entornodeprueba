import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import {
  createSaveDailyRecordResult,
  createUpdatePartialDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecordRecoveryDecision } from '@/services/repositories/dailyRecordRecoveryPolicy';
import type { DailyRecordRetryability } from '@/services/repositories/contracts/dailyRecordConsistency';
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
  retryability: DailyRecordRetryability;
  recoveryAction:
    | 'none'
    | 'defer_remote_sync'
    | 'queue_retry'
    | 'auto_merge_and_queue'
    | 'block_and_surface';
  conflictSummary: DailyRecordRecoveryDecision['conflictSummary'];
  observabilityTags: string[];
  userSafeMessage?: string;
  blockingReason?: 'regression' | 'version_mismatch' | 'validation';
  blockingError?: Error;
  confirmedRecord?: DailyRecord;
}

export const createRemoteWriteState = (): RemoteWriteState => ({
  savedLocally: false,
  savedRemotely: false,
  queuedForRetry: false,
  autoMerged: false,
  consistencyState: 'persisted_local_only',
  retryability: 'not_applicable',
  recoveryAction: isFirestoreEnabled() ? 'defer_remote_sync' : 'none',
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
  state.retryability = decision.retryability;
  state.recoveryAction = decision.recoveryAction;
  state.conflictSummary = decision.conflictSummary;
  state.observabilityTags = decision.observabilityTags;
  state.userSafeMessage = decision.userSafeMessage;
  state.blockingReason = decision.blockingReason;
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
    sourceOfTruth: state.savedRemotely ? 'remote' : state.savedLocally ? 'local' : 'none',
    retryability: state.retryability,
    recoveryAction: state.recoveryAction,
    conflictSummary: state.conflictSummary,
    observabilityTags: state.observabilityTags,
    userSafeMessage: state.userSafeMessage,
    blockingReason: state.blockingReason,
    repairApplied: false,
    blockingError: state.blockingError,
    confirmedRecord: state.confirmedRecord,
  });

export const buildPartialUpdateResult = (
  date: string,
  state: RemoteWriteState,
  patchedFields: number
) =>
  createUpdatePartialDailyRecordResult({
    date,
    outcome: resolveCompatibilityOutcome(state),
    savedLocally: state.savedLocally,
    updatedRemotely: state.savedRemotely,
    queuedForRetry: state.queuedForRetry,
    autoMerged: state.autoMerged,
    patchedFields,
    consistencyState: state.consistencyState,
    sourceOfTruth: state.savedRemotely ? 'remote' : state.savedLocally ? 'local' : 'none',
    retryability: state.retryability,
    recoveryAction: state.recoveryAction,
    conflictSummary: state.conflictSummary,
    observabilityTags: state.observabilityTags,
    userSafeMessage: state.userSafeMessage,
    blockingReason: state.blockingReason,
    repairApplied: false,
    blockingError: state.blockingError,
    confirmedRecord: state.confirmedRecord,
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
    sourceOfTruth: 'none',
    retryability: state.retryability,
    recoveryAction: state.recoveryAction,
    conflictSummary: state.conflictSummary,
    observabilityTags: state.observabilityTags,
    userSafeMessage: state.userSafeMessage,
    blockingReason: state.blockingReason,
    repairApplied: false,
    blockingError: state.blockingError,
  });

export const buildBlockedPartialUpdateResult = (
  date: string,
  state: RemoteWriteState,
  patchedFields: number
) =>
  createUpdatePartialDailyRecordResult({
    date,
    outcome: 'blocked',
    savedLocally: false,
    updatedRemotely: false,
    queuedForRetry: false,
    autoMerged: false,
    patchedFields,
    consistencyState: state.consistencyState,
    sourceOfTruth: 'none',
    retryability: state.retryability,
    recoveryAction: state.recoveryAction,
    conflictSummary: state.conflictSummary,
    observabilityTags: state.observabilityTags,
    userSafeMessage: state.userSafeMessage,
    blockingReason: state.blockingReason,
    repairApplied: false,
    blockingError: state.blockingError,
  });
