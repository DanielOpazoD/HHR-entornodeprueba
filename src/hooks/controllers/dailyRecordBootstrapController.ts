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
}

export interface ResolveCensusEmptyStatePolicyInput {
  branch: 'register' | 'empty' | 'analytics';
  currentDateString: string;
  todayDateString: string;
  isAuthenticated: boolean;
  bootstrapPhase: DailyRecordBootstrapPhase;
}

export type CensusEmptyStateDiagnosticSource =
  | 'remote_missing'
  | 'local_cache_empty'
  | 'sync_pending'
  | 'post_deploy_refresh'
  | 'date_mismatch';

export interface CensusEmptyStateDiagnostic {
  source: CensusEmptyStateDiagnosticSource;
  message: string;
}

export interface ResolveCensusEmptyStateDiagnosticInput extends ResolveCensusEmptyStatePolicyInput {
  hasPostDeployRefreshMarker?: boolean;
}

export const resolveDailyRecordBootstrapPhase = ({
  remoteSyncStatus,
  record,
  runtime,
  gracePeriodExpired,
}: ResolveDailyRecordBootstrapPhaseInput): DailyRecordBootstrapPhase => {
  if (record) {
    return 'record_ready';
  }

  if (remoteSyncStatus === 'ready' && runtime?.availabilityState === 'confirmed_missing') {
    return 'confirmed_empty';
  }

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
}): boolean =>
  currentDateString === todayDateString &&
  (bootstrapPhase === 'remote_record_bootstrapping' || bootstrapPhase === 'remote_record_timeout');

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

export const resolveCensusEmptyStateDiagnostic = ({
  branch,
  currentDateString,
  todayDateString,
  isAuthenticated,
  bootstrapPhase,
  hasPostDeployRefreshMarker = false,
}: ResolveCensusEmptyStateDiagnosticInput): CensusEmptyStateDiagnostic => {
  if (branch !== 'empty') {
    return {
      source: 'remote_missing',
      message: '',
    };
  }

  if (hasPostDeployRefreshMarker) {
    return {
      source: 'post_deploy_refresh',
      message:
        'La app se actualizo recientemente y esta revalidando los registros locales recientes antes de confirmar que el dia esta vacio.',
    };
  }

  if (currentDateString !== todayDateString && bootstrapPhase === 'confirmed_empty') {
    return {
      source: 'date_mismatch',
      message:
        'No existe registro para la fecha seleccionada. Verifica que estes mirando el dia correcto antes de crear un censo nuevo.',
    };
  }

  if (isAuthenticated && bootstrapPhase !== 'confirmed_empty') {
    return {
      source: 'sync_pending',
      message:
        'Todavia se esta verificando Firebase y la copia local. Si esperabas pacientes, espera la sincronizacion antes de crear un registro en blanco.',
    };
  }

  if (bootstrapPhase === 'local_only') {
    return {
      source: 'local_cache_empty',
      message:
        'No hay registro en la copia local y la sincronizacion remota no esta disponible en este momento.',
    };
  }

  return {
    source: 'remote_missing',
    message:
      'Firebase y la copia local no tienen registro para esta fecha. Crea el dia solo si corresponde iniciar un censo nuevo.',
  };
};

export const shouldRecordCensusEmptyStateDiagnostic = ({
  branch,
  source,
  isVisible,
}: {
  branch: 'register' | 'empty' | 'analytics';
  source: CensusEmptyStateDiagnosticSource;
  isVisible: boolean;
}): boolean => branch === 'empty' && isVisible && Boolean(source);
