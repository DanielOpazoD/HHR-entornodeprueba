import type { DailyRecord } from '@/types/domain/dailyRecord';
import type {
  DailyRecordConflictSummary,
  DailyRecordRecoveryAction,
  DailyRecordRetryability,
  DailyRecordSourceOfTruth,
  DailyRecordSyncConsistencyState,
} from '@/services/repositories/contracts/dailyRecordConsistency';
import { resolveApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';

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

/**
 * What a full save or a partial update left, decided once by the repository that wrote it.
 * `savedHere`: its producer recorded a copy on this computer. `confirmed`: the server holds it
 * (`stale`: this computer's copy could not follow). `local`: not refused, and the queue sends it
 * by itself; without `savedHere` the producer recorded no copy, so the box says error and the
 * notice «not saved». `held`: kept here, waiting for a person or for its author. `not_saved`: not
 * on the day: blocked, not stored, or its session ended first.
 */
export type DailyRecordWriteResult = {
  date: string;
  savedHere: boolean;
  userSafeMessage?: string;
  /** The producer's own error; a blocked write keeps its class (regression, version, validation). */
  blockingError?: Error;
  /** Another writer changed the day first: the caller's error travels as `ConcurrencyError`. */
  concurrencyConflict?: true;
  /** Exact server-confirmed state returned or read back after the write, when available. */
  confirmedRecord?: DailyRecord;
  /** Local projection rebased onto that confirmed state while other local work is pending. */
  localProjectionRecord?: DailyRecord;
} & (
  | { state: 'confirmed'; localCopy: 'current' | 'stale' }
  | { state: 'local'; cause: 'stored' | 'retrying' | 'merged' | 'queue_route' }
  | { state: 'held'; reason: 'field_changed_elsewhere' | 'session_changed' | 'needs_review' }
  | { state: 'not_saved'; reason: 'blocked' | 'session_changed' | 'local_failed' }
);

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

/**
 * A write that cannot safely continue the caller's workflow, even if it returned a result. A
 * session that ended during a direct send keeps the edit in its author's queue and is not one.
 */
export const isDailyRecordWriteRejectedResult = (
  result: DailyRecordWriteResult | null | undefined
): boolean =>
  Boolean(
    result &&
    (result.state === 'not_saved' ||
      (result.state === 'held' && result.reason === 'needs_review') ||
      (result.state === 'confirmed' && result.localCopy === 'stale'))
  );

/**
 * The only conversion of a write result into the error its caller throws: the producer's own
 * error when it attached one, otherwise the result's message (or `fallbackMessage`). A conflict
 * with another writer travels named `ConcurrencyError`, which Rayen's replan loop retries on a
 * fresh read; a producer's error that already has its own class keeps it.
 */
export const toDailyRecordWriteError = (
  result: DailyRecordWriteResult,
  fallbackMessage: string
): Error => {
  const error =
    result.blockingError ?? new Error(resolveApplicationOutcomeMessage(result, fallbackMessage));
  if (result.concurrencyConflict && error.name === 'Error') {
    error.name = 'ConcurrencyError';
  }
  return error;
};
