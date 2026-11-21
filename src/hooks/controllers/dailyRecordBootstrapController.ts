import type { DailyRecordQueryRuntime } from '@/services/repositories/contracts/dailyRecordQueries';
import type { RemoteSyncRuntimeStatus } from '@/services/repositories/repositoryConfig';

export type DailyRecordBootstrapPhase =
  | 'local_only'
  | 'remote_runtime_bootstrapping'
  | 'remote_record_bootstrapping'
  | 'remote_record_timeout'
  | 'record_ready'
  | 'confirmed_empty';

export interface ResolveDailyRecordBootstrapPhaseInput {
  remoteSyncStatus: RemoteSyncRuntimeStatus;
  record: unknown | null;
  runtime: DailyRecordQueryRuntime | null;
  gracePeriodExpired: boolean;
  currentDateString?: string;
  isFetching?: boolean;
  isError?: boolean;
}

export interface ResolveCensusEmptyStatePolicyInput {
  branch: 'register' | 'empty' | 'analytics';
  currentDateString: string;
  todayDateString: string;
  isAuthenticated: boolean;
  bootstrapPhase: DailyRecordBootstrapPhase;
}

export const resolveDailyRecordBootstrapPhase = ({
  remoteSyncStatus,
  record,
  runtime,
  gracePeriodExpired,
  currentDateString,
  isFetching = false,
  isError = false,
}: ResolveDailyRecordBootstrapPhaseInput): DailyRecordBootstrapPhase => {
  if (record) {
    return 'record_ready';
  }

  const sameDate = !currentDateString || runtime?.date === currentDateString;
  const authoritativeAbsence = runtime?.conflictSummary?.kind === 'remote_missing';
  if (
    remoteSyncStatus === 'ready' &&
    sameDate &&
    !isFetching &&
    !isError &&
    authoritativeAbsence &&
    runtime?.availabilityState === 'confirmed_missing'
  ) {
    return 'confirmed_empty';
  }

  if (isError || gracePeriodExpired) return 'remote_record_timeout';

  if (remoteSyncStatus === 'bootstrapping') {
    return 'remote_runtime_bootstrapping';
  }

  if (remoteSyncStatus !== 'ready') {
    return 'local_only';
  }

  return gracePeriodExpired ? 'remote_record_timeout' : 'remote_record_bootstrapping';
};

export const shouldAttemptTodayEmptyRecovery = ({
  currentDateString,
  todayDateString,
  bootstrapPhase,
}: {
  currentDateString: string;
  todayDateString: string;
  bootstrapPhase: DailyRecordBootstrapPhase;
}): boolean => currentDateString === todayDateString && bootstrapPhase === 'remote_record_timeout';
