import type { ResolveCensusEmptyStatePolicyInput } from '@/hooks/controllers/dailyRecordBootstrapController';

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

  if (bootstrapPhase === 'remote_record_timeout') {
    return {
      source: 'local_cache_empty',
      message: 'No se pudo comprobar el censo remoto; la ausencia no esta confirmada.',
    };
  }

  if (hasPostDeployRefreshMarker && bootstrapPhase !== 'confirmed_empty') {
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

  if (bootstrapPhase === 'local_only') {
    return {
      source: 'local_cache_empty',
      message:
        'No hay registro en la copia local y la sincronizacion remota no esta disponible en este momento.',
    };
  }

  if (isAuthenticated && bootstrapPhase !== 'confirmed_empty') {
    return {
      source: 'sync_pending',
      message:
        'Todavia se esta verificando Firebase y la copia local. Si esperabas pacientes, espera la sincronizacion antes de crear un registro en blanco.',
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
