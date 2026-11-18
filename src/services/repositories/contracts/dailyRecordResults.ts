import type { DailyRecord } from '@/types/domain/dailyRecord';
import type {
  DailyRecordConflictSummary,
  DailyRecordRecoveryAction,
  DailyRecordRetryability,
  DailyRecordSourceOfTruth,
  DailyRecordSyncConsistencyState,
  DailyRecordWriteConsistencyState,
} from '@/services/repositories/contracts/dailyRecordConsistency';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const assertDate = (date: string, operation: string): void => {
  if (!date || !ISO_DATE_REGEX.test(date)) {
    throw new Error(`[RepositoryContract] Invalid date format for ${operation}: "${date}"`);
  }
};

export interface SaveDailyRecordResult {
  date: string;
  outcome: 'clean' | 'queued' | 'auto_merged' | 'blocked' | 'unrecoverable';
  savedLocally: boolean;
  savedRemotely: boolean;
  queuedForRetry: boolean;
  autoMerged: boolean;
  consistencyState: DailyRecordWriteConsistencyState;
  conflictSummary: DailyRecordConflictSummary | null;
  observabilityTags: string[];
  userSafeMessage?: string;
  blockingError?: Error;
  /** Exact server-confirmed state returned by the authority callable, when available. */
  confirmedRecord?: DailyRecord;
  /** Retained local work that the full-save response did not confirm. */
  localProjectionRecord?: DailyRecord;
}

type SaveDailyRecordResultInput = Pick<
  SaveDailyRecordResult,
  'date' | 'outcome' | 'savedLocally' | 'savedRemotely' | 'queuedForRetry' | 'autoMerged'
> &
  Partial<
    Omit<
      SaveDailyRecordResult,
      'date' | 'outcome' | 'savedLocally' | 'savedRemotely' | 'queuedForRetry' | 'autoMerged'
    >
  >;

export interface UpdatePartialDailyRecordResult {
  date: string;
  outcome: 'clean' | 'queued' | 'auto_merged' | 'blocked' | 'unrecoverable';
  savedLocally: boolean;
  updatedRemotely: boolean;
  queuedForRetry: boolean;
  autoMerged: boolean;
  consistencyState: DailyRecordWriteConsistencyState;
  conflictSummary: DailyRecordConflictSummary | null;
  observabilityTags: string[];
  userSafeMessage?: string;
  blockingError?: Error;
  /** Exact server-confirmed state returned or read back after the patch, when requested. */
  confirmedRecord?: DailyRecord;
  /** Local projection rebased onto that confirmed state while another granular write is pending. */
  localProjectionRecord?: DailyRecord;
}

type UpdatePartialDailyRecordResultInput = Pick<
  UpdatePartialDailyRecordResult,
  'date' | 'outcome' | 'savedLocally' | 'updatedRemotely' | 'queuedForRetry' | 'autoMerged'
> &
  Partial<
    Omit<
      UpdatePartialDailyRecordResult,
      'date' | 'outcome' | 'savedLocally' | 'updatedRemotely' | 'queuedForRetry' | 'autoMerged'
    >
  >;

export interface SyncDailyRecordResult {
  publication?: 'superseded';
  serverConfirmed: boolean;
  date: string;
  outcome: 'clean' | 'missing' | 'blocked';
  record: DailyRecord | null;
  consistencyState: DailyRecordSyncConsistencyState;
  sourceOfTruth: DailyRecordSourceOfTruth;
  retryability: DailyRecordRetryability;
  recoveryAction: DailyRecordRecoveryAction;
  conflictSummary: DailyRecordConflictSummary | null;
  observabilityTags: string[];
  userSafeMessage?: string;
  repairApplied: boolean;
}

type SyncDailyRecordResultInput = Pick<SyncDailyRecordResult, 'date' | 'outcome' | 'record'> &
  Partial<Omit<SyncDailyRecordResult, 'date' | 'outcome' | 'record'>>;

export interface InitializeDayResult {
  date: string;
  outcome: 'clean' | 'repaired';
  sourceDate?: string;
}

export interface CopyPatientResult {
  sourceDate: string;
  targetDate: string;
  outcome: 'clean' | 'repaired';
}

/** Tags a write queued as a conflict because another device changed the same field (SAVE-02). */
export const FIELD_CHANGED_ELSEWHERE_TAG = 'field_changed_elsewhere';

/** Tags an edit that only the day's queue task saves (a movement that frees a bed). */
export const SAVED_BY_QUEUE_ROUTE_TAG = 'saved_by_queue_route';

/** Persistence evidence for the attempted write, independent of promise resolution. */
export const resolveDailyRecordSavedState = (result: {
  savedLocally: boolean;
  savedRemotely?: boolean;
  updatedRemotely?: boolean;
}): 'saved' | 'local' | 'error' =>
  result.savedRemotely || result.updatedRemotely
    ? 'saved'
    : result.savedLocally
      ? 'local'
      : 'error';

const resolveWriteConsistencyState = (
  outcome: SaveDailyRecordResult['outcome'],
  remotelyConfirmed: boolean
): DailyRecordWriteConsistencyState =>
  outcome === 'queued'
    ? 'queued_for_retry'
    : outcome === 'auto_merged'
      ? 'auto_merged'
      : outcome === 'unrecoverable'
        ? 'unrecoverable'
        : outcome === 'blocked'
          ? 'blocked_validation'
          : remotelyConfirmed
            ? 'persisted_and_synced'
            : 'persisted_local_only';

export const createSaveDailyRecordResult = (
  input: SaveDailyRecordResultInput
): SaveDailyRecordResult => {
  assertDate(input.date, 'save result');
  return {
    ...input,
    conflictSummary: input.conflictSummary || null,
    observabilityTags: Array.from(new Set(input.observabilityTags || ['daily_record', 'write'])),
    consistencyState:
      input.consistencyState || resolveWriteConsistencyState(input.outcome, input.savedRemotely),
  };
};

export const createUpdatePartialDailyRecordResult = (
  input: UpdatePartialDailyRecordResultInput
): UpdatePartialDailyRecordResult => {
  assertDate(input.date, 'updatePartial result');
  return {
    ...input,
    conflictSummary: input.conflictSummary || null,
    observabilityTags: Array.from(new Set(input.observabilityTags || ['daily_record', 'write'])),
    consistencyState:
      input.consistencyState || resolveWriteConsistencyState(input.outcome, input.updatedRemotely),
  };
};

export const createSyncDailyRecordResult = (
  input: SyncDailyRecordResultInput
): SyncDailyRecordResult => {
  assertDate(input.date, 'sync result');
  return {
    ...input,
    serverConfirmed: input.serverConfirmed ?? false,
    conflictSummary: input.conflictSummary || null,
    observabilityTags: Array.from(new Set(input.observabilityTags || ['daily_record', 'sync'])),
    repairApplied: input.repairApplied || false,
    sourceOfTruth: input.sourceOfTruth || (input.record ? 'remote' : 'none'),
    consistencyState:
      input.consistencyState ||
      (input.outcome === 'missing'
        ? 'missing_remote'
        : input.outcome === 'blocked'
          ? 'blocked'
          : 'up_to_date'),
    retryability:
      input.retryability ||
      (input.outcome === 'missing'
        ? 'manual_retry'
        : input.outcome === 'blocked'
          ? 'automatic_retry'
          : 'not_applicable'),
    recoveryAction:
      input.recoveryAction ||
      (input.outcome === 'missing'
        ? 'defer_remote_sync'
        : input.outcome === 'blocked'
          ? 'defer_remote_sync'
          : 'none'),
  };
};

export const createInitializeDayResult = (input: InitializeDayResult): InitializeDayResult => {
  assertDate(input.date, 'initializeDay result');
  return input;
};

export const createCopyPatientResult = (input: CopyPatientResult): CopyPatientResult => {
  assertDate(input.sourceDate, 'copyPatient source result');
  assertDate(input.targetDate, 'copyPatient target result');
  return input;
};

export const isDailyRecordWriteBlockedResult = (
  result: SaveDailyRecordResult | UpdatePartialDailyRecordResult | null | undefined
): boolean =>
  Boolean(
    result &&
    (result.consistencyState === 'blocked_regression' ||
      result.consistencyState === 'blocked_version_mismatch' ||
      result.consistencyState === 'blocked_validation')
  );

/** A write that cannot safely continue the caller's workflow, even if it returned a result. */
export const isDailyRecordWriteRejectedResult = (
  result: SaveDailyRecordResult | UpdatePartialDailyRecordResult | null | undefined
): boolean =>
  Boolean(
    result &&
    (result.outcome === 'blocked' ||
      result.outcome === 'unrecoverable' ||
      isDailyRecordWriteBlockedResult(result))
  );
