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

/**
 * Why a write did not simply land, set by the producer that decided it (never read from tags):
 * `session_changed`: the authoring session ended before the write finished; `field_changed_elsewhere`:
 * another device changed the same field, so the edit is held as a conflict with this device's text
 * (SAVE-02); `queue_route`: only the day's queue task saves it (a movement that frees a bed).
 */
export type DailyRecordWriteReason = 'session_changed' | 'field_changed_elsewhere' | 'queue_route';

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
  reason?: DailyRecordWriteReason;
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
  reason?: DailyRecordWriteReason;
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

/**
 * What a write left, in one place. `savedHere`: its producer recorded a copy on this computer.
 * `confirmed`: the server holds it (`stale`: this computer's copy could not follow). `local`: not
 * refused, and the queue sends it by itself; without `savedHere` the producer recorded no copy,
 * so the box says error. `held`: kept here, waiting for a person or for its author. `not_saved`:
 * not on the day: blocked, not stored, or its session ended first.
 */
export type DailyRecordWriteStatus = { savedHere: boolean } & (
  | { state: 'confirmed'; localCopy: 'current' | 'stale' }
  | { state: 'local'; cause: 'stored' | 'retrying' | 'merged' | 'queue_route' }
  | { state: 'held'; reason: 'field_changed_elsewhere' | 'session_changed' | 'needs_review' }
  | { state: 'not_saved'; reason: 'blocked' | 'session_changed' | 'local_failed' }
);

/** The only derivation of a write's state: the notice, the sync box and the guards read it. */
export const resolveDailyRecordWriteStatus = (
  result: SaveDailyRecordResult | UpdatePartialDailyRecordResult
): DailyRecordWriteStatus => {
  const savedHere = result.savedLocally;
  if (result.reason === 'session_changed') {
    return savedHere
      ? { savedHere, state: 'held', reason: 'session_changed' }
      : { savedHere, state: 'not_saved', reason: 'session_changed' };
  }
  if (result.reason === 'queue_route') return { savedHere, state: 'local', cause: 'queue_route' };
  if (result.reason === 'field_changed_elsewhere') {
    return { savedHere, state: 'held', reason: 'field_changed_elsewhere' };
  }
  if (result.outcome === 'blocked' || isDailyRecordWriteBlockedResult(result)) {
    return { savedHere, state: 'not_saved', reason: 'blocked' };
  }
  const unrecoverable =
    result.outcome === 'unrecoverable' || result.consistencyState === 'unrecoverable';
  const savedRemotely = 'savedRemotely' in result ? result.savedRemotely : result.updatedRemotely;
  if (savedRemotely) {
    return { savedHere, state: 'confirmed', localCopy: unrecoverable ? 'stale' : 'current' };
  }
  // A full save merged before its local write keeps `savedHere` false: the box says error.
  if (result.outcome === 'auto_merged' && result.autoMerged) {
    return { savedHere, state: 'local', cause: 'merged' };
  }
  if (unrecoverable) {
    return savedHere
      ? { savedHere, state: 'held', reason: 'needs_review' }
      : { savedHere, state: 'not_saved', reason: 'local_failed' };
  }
  if (result.outcome === 'queued' && result.queuedForRetry) {
    return { savedHere, state: 'local', cause: 'retrying' };
  }
  return { savedHere, state: 'local', cause: 'stored' };
};

/**
 * A write that cannot safely continue the caller's workflow, even if it returned a result. A
 * session that ended during a direct send keeps the edit in its author's queue and is not one.
 */
export const isDailyRecordWriteRejectedResult = (
  result: SaveDailyRecordResult | UpdatePartialDailyRecordResult | null | undefined
): boolean => {
  if (!result) return false;
  const status = resolveDailyRecordWriteStatus(result);
  return (
    status.state === 'not_saved' ||
    (status.state === 'held' && status.reason === 'needs_review') ||
    (status.state === 'confirmed' && status.localCopy === 'stale')
  );
};
