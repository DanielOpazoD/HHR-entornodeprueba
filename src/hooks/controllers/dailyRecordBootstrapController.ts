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
  const authoritativeAbsence =
    runtime?.conflictSummary?.kind === 'remote_missing' ||
    runtime?.consistencyState === 'missing_remote';
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

export const isDailyRecordBootstrapPending = (phase: DailyRecordBootstrapPhase): boolean =>
  phase === 'remote_runtime_bootstrapping' || phase === 'remote_record_bootstrapping';

export const shouldAttemptTodayEmptyRecovery = ({
  currentDateString,
  todayDateString,
  bootstrapPhase,
}: {
  currentDateString: string;
  todayDateString: string;
  bootstrapPhase: DailyRecordBootstrapPhase;
}): boolean => currentDateString === todayDateString && bootstrapPhase === 'remote_record_timeout';

export const resolveCensusEmptyStatePolicy = ({
  branch,
  currentDateString,
  todayDateString,
  isAuthenticated,
  bootstrapPhase,
}: ResolveCensusEmptyStatePolicyInput): { shouldDeferEmptyState: boolean; deferMs: number } => {
  if (branch !== 'empty') {
    return {
      shouldDeferEmptyState: false,
      deferMs: 0,
    };
  }

  const isToday = currentDateString === todayDateString;
  const shouldDeferRemoteBootstrap =
    isAuthenticated && isDailyRecordBootstrapPending(bootstrapPhase);
  const shouldExtendTodayRemoteRecovery =
    isAuthenticated && isToday && bootstrapPhase === 'remote_record_timeout';
  const isConfirmedEmpty = bootstrapPhase === 'confirmed_empty';

  // Always defer briefly so Firestore has time to resolve the record
  // before showing the empty-day prompt. Skip only when the repository
  // has explicitly confirmed the date has no data.
  return {
    shouldDeferEmptyState: !isConfirmedEmpty,
    deferMs:
      shouldDeferRemoteBootstrap || shouldExtendTodayRemoteRecovery
        ? 15_000
        : isToday
          ? 1_200
          : 800,
  };
};

export const describeDailyRecordBootstrapPhase = (phase: DailyRecordBootstrapPhase): string => {
  switch (phase) {
    case 'local_only':
      return 'El runtime remoto no esta disponible; el registro opera en modo local.';
    case 'remote_runtime_bootstrapping':
      return 'Auth/runtime remoto aun se esta rehidratando antes de consultar el registro.';
    case 'remote_record_bootstrapping':
      return 'El runtime remoto ya esta listo, pero la primera resolucion del registro aun no concluye.';
    case 'remote_record_timeout':
      return 'La primera resolucion remota del registro excedio la ventana de gracia.';
    case 'confirmed_empty':
      return 'El repositorio confirmo que no existe registro remoto/local para la fecha.';
    case 'record_ready':
    default:
      return 'El registro del dia quedo resuelto para la UI.';
  }
};
