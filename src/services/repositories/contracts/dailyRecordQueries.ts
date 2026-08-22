import { DailyRecord } from '@/types/domain/dailyRecord';
import {
  LegacyMigrationRule,
  MigrationCompatibilityIntensity,
} from '@/services/repositories/dataMigrationContracts';
import type {
  DailyRecordConflictSummary,
  DailyRecordReadConsistencyState,
  DailyRecordRecoveryAction,
  DailyRecordRetryability,
  DailyRecordSourceOfTruth,
  DailyRecordSyncConsistencyState,
} from '@/services/repositories/contracts/dailyRecordConsistency';
import type { DailyRecordQueuedWriteState } from '@/services/storage/syncQueueTypes';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export interface GetDailyRecordQuery {
  date: string;
  syncFromRemote: boolean;
}

export interface GetPreviousDayQuery {
  date: string;
}

export type DailyRecordReadSource =
  | 'e2e'
  | 'demo'
  | 'indexeddb'
  | 'firestore'
  | 'legacy_bridge'
  | 'not_found';

export interface DailyRecordReadResult {
  date: string;
  record: DailyRecord | null;
  source: DailyRecordReadSource;
  compatibilityTier: 'local_runtime' | 'current_firestore' | 'legacy_bridge' | 'none';
  compatibilityIntensity: MigrationCompatibilityIntensity;
  migrationRulesApplied: LegacyMigrationRule[];
  consistencyState: DailyRecordReadConsistencyState;
  sourceOfTruth: DailyRecordSourceOfTruth;
  retryability: DailyRecordRetryability;
  recoveryAction: DailyRecordRecoveryAction;
  conflictSummary: DailyRecordConflictSummary | null;
  observabilityTags: string[];
  userSafeMessage?: string;
  repairApplied: boolean;
}

export interface LocalDailyRecordReadResult {
  record: DailyRecord | null;
  /** The local record is still represented by an active outbox write for this exact version. */
  hasPendingWrites: boolean;
  /** Exact outbox state used to block overwriting unresolved failed/conflicted local edits. */
  writeState: DailyRecordQueuedWriteState;
}

export type DailyRecordQueryAvailabilityState =
  | 'resolved'
  | 'recoverable_local'
  | 'confirmed_missing'
  | 'temporarily_unavailable';

export interface DailyRecordQueryRuntime {
  date: string;
  availabilityState: DailyRecordQueryAvailabilityState;
  consistencyState: DailyRecordReadConsistencyState | DailyRecordSyncConsistencyState;
  sourceOfTruth: DailyRecordSourceOfTruth;
  retryability: DailyRecordRetryability;
  recoveryAction: DailyRecordRecoveryAction;
  conflictSummary: DailyRecordConflictSummary | null;
  observabilityTags: string[];
  userSafeMessage?: string;
  repairApplied: boolean;
}

export interface DailyRecordQueryResult {
  record: DailyRecord | null;
  runtime: DailyRecordQueryRuntime;
}

const assertDate = (date: string, operation: string): void => {
  if (!ISO_DATE_REGEX.test(date || '')) {
    throw new Error(`[RepositoryContract] Invalid date format for ${operation}: "${date}"`);
  }
};

const resolveDefaultReadConsistencyState = (
  source: DailyRecordReadSource
): DailyRecordReadConsistencyState => {
  switch (source) {
    case 'firestore':
      return 'remote_authoritative';
    case 'indexeddb':
    case 'e2e':
    case 'demo':
    case 'legacy_bridge':
      return 'local_only';
    case 'not_found':
    default:
      return 'missing';
  }
};

export const createGetDailyRecordQuery = (
  date: string,
  syncFromRemote: boolean = true
): GetDailyRecordQuery => {
  assertDate(date, 'getForDate');
  return {
    date,
    syncFromRemote,
  };
};

export const createGetPreviousDayQuery = (date: string): GetPreviousDayQuery => {
  assertDate(date, 'getPreviousDay');
  return { date };
};

export const createDailyRecordReadResult = (
  date: string,
  record: DailyRecord | null,
  source: DailyRecordReadSource,
  options: Partial<
    Pick<
      DailyRecordReadResult,
      | 'compatibilityTier'
      | 'compatibilityIntensity'
      | 'migrationRulesApplied'
      | 'consistencyState'
      | 'sourceOfTruth'
      | 'retryability'
      | 'recoveryAction'
      | 'conflictSummary'
      | 'observabilityTags'
      | 'userSafeMessage'
      | 'repairApplied'
    >
  > = {}
): DailyRecordReadResult => {
  assertDate(date, 'createDailyRecordReadResult');
  if (record && record.date !== date) {
    throw new Error(
      `[RepositoryContract] Read result date mismatch. Expected ${date} but received ${record.date}`
    );
  }

  return {
    date,
    record,
    source,
    compatibilityTier: options.compatibilityTier || 'none',
    compatibilityIntensity: options.compatibilityIntensity || 'none',
    migrationRulesApplied: options.migrationRulesApplied || [],
    consistencyState: options.consistencyState || resolveDefaultReadConsistencyState(source),
    sourceOfTruth:
      options.sourceOfTruth || (source === 'firestore' ? 'remote' : record ? 'local' : 'none'),
    retryability: options.retryability || 'not_applicable',
    recoveryAction: options.recoveryAction || 'none',
    conflictSummary: options.conflictSummary || null,
    observabilityTags: options.observabilityTags || ['daily_record', 'read'],
    userSafeMessage: options.userSafeMessage,
    repairApplied: options.repairApplied || false,
  };
};

export const createDailyRecordQueryResult = (
  record: DailyRecord | null,
  runtime: DailyRecordQueryRuntime
): DailyRecordQueryResult => ({
  record,
  runtime: {
    ...runtime,
    conflictSummary: runtime.conflictSummary || null,
    observabilityTags: Array.from(new Set(runtime.observabilityTags)),
    repairApplied: runtime.repairApplied || false,
  },
});
