export type DailyRecordSourceOfTruth = 'local' | 'remote' | 'none';

export type DailyRecordRetryability =
  | 'not_applicable'
  | 'automatic_retry'
  | 'manual_retry'
  | 'manual_review'
  | 'blocked';

export type DailyRecordRecoveryAction =
  | 'none'
  | 'defer_remote_sync'
  | 'queue_retry'
  | 'auto_merge_and_queue'
  | 'block_and_surface';

export type DailyRecordReadConsistencyState =
  | 'local_only'
  | 'remote_authoritative'
  | 'local_authoritative'
  | 'repaired_local'
  | 'missing'
  | 'unavailable';

export type DailyRecordWriteConsistencyState =
  | 'persisted_local_only'
  | 'persisted_and_synced'
  | 'queued_for_retry'
  | 'auto_merged'
  | 'blocked_regression'
  | 'blocked_version_mismatch'
  | 'blocked_validation'
  | 'unrecoverable';

export type DailyRecordSyncConsistencyState =
  | 'up_to_date'
  | 'remote_applied'
  | 'local_kept'
  | 'conflict_auto_merged'
  | 'missing_remote'
  | 'blocked';

export type DailyRecordConflictKind =
  | 'remote_missing'
  | 'remote_unavailable'
  | 'remote_stale'
  | 'local_persistence_failed'
  | 'concurrency'
  | 'regression_blocked'
  | 'version_mismatch'
  | 'validation_blocked'
  | 'hydrated_from_remote'
  | 'repair_applied';

export interface DailyRecordConflictSummary {
  kind: DailyRecordConflictKind;
  sourceOfTruth: DailyRecordSourceOfTruth;
  localTimestamp?: string;
  remoteTimestamp?: string;
  changedPaths?: string[];
  message?: string;
}

export interface DailyRecordConsistencyMetadata<TState extends string> {
  consistencyState: TState;
  sourceOfTruth: DailyRecordSourceOfTruth;
  retryability: DailyRecordRetryability;
  recoveryAction: DailyRecordRecoveryAction;
  conflictSummary: DailyRecordConflictSummary | null;
  observabilityTags: string[];
  userSafeMessage?: string;
  repairApplied: boolean;
}

export const createConsistencyMetadata = <TState extends string>(
  input: DailyRecordConsistencyMetadata<TState>
): DailyRecordConsistencyMetadata<TState> => ({
  ...input,
  observabilityTags: Array.from(new Set(input.observabilityTags)),
});
