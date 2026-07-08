import type { SyncStatus } from '@/context/dailyRecordContextContracts';
import type { DailyRecordBootstrapPhase } from '@/hooks/controllers/dailyRecordBootstrapController';
import type { CensusViewBranch } from '@/features/census/controllers/censusViewController';

export type CensusOperationalPhase =
  | 'loading_remote'
  | 'using_local_cache'
  | 'reconciling_remote'
  | 'remote_confirmed'
  | 'confirmed_empty'
  | 'sync_pending'
  | 'error';

export interface ResolveCensusOperationalStateInput {
  branch: CensusViewBranch;
  bootstrapPhase: DailyRecordBootstrapPhase;
  syncStatus: SyncStatus;
  hasRecord: boolean;
  isAuthenticated: boolean;
}

export interface CensusOperationalState {
  phase: CensusOperationalPhase;
  isSettled: boolean;
  shouldShowBanner: boolean;
  label: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export const resolveCensusOperationalState = ({
  branch,
  bootstrapPhase,
  syncStatus,
  hasRecord,
  isAuthenticated,
}: ResolveCensusOperationalStateInput): CensusOperationalState => {
  if (syncStatus === 'error') {
    return {
      phase: 'error',
      isSettled: false,
      shouldShowBanner: true,
      label: 'Error de sincronizacion',
      message:
        'El censo local sigue visible, pero la ultima sincronizacion reporto un error. Reintenta o recarga antes de tomar el estado como definitivo.',
      severity: 'error',
    };
  }

  if (branch === 'empty') {
    if (bootstrapPhase === 'confirmed_empty') {
      return {
        phase: 'confirmed_empty',
        isSettled: true,
        shouldShowBanner: false,
        label: 'Dia vacio confirmado',
        message: 'Ya se confirmó que no existe registro para esta fecha.',
        severity: 'info',
      };
    }

    return {
      phase: isAuthenticated ? 'sync_pending' : 'loading_remote',
      isSettled: false,
      shouldShowBanner: false,
      label: isAuthenticated ? 'Verificando censo' : 'Cargando censo',
      message:
        'Aun no se debe interpretar este dia como vacio: la app esta verificando los últimos datos.',
      severity: 'warning',
    };
  }

  if (hasRecord && bootstrapPhase === 'record_ready') {
    return {
      phase: 'remote_confirmed',
      isSettled: true,
      shouldShowBanner: false,
      label: 'Censo sincronizado',
      message: 'El registro diario esta listo para operar.',
      severity: 'info',
    };
  }

  if (hasRecord && bootstrapPhase === 'local_only') {
    return {
      phase: 'using_local_cache',
      isSettled: false,
      shouldShowBanner: false,
      label: 'Mostrando copia local',
      message: 'El censo visible se mantiene disponible mientras se confirman los últimos datos.',
      severity: 'warning',
    };
  }

  if (hasRecord) {
    return {
      phase: 'reconciling_remote',
      isSettled: false,
      shouldShowBanner: false,
      label: 'Actualizando censo',
      message: 'El censo ya es visible mientras se confirman los últimos datos.',
      severity: 'info',
    };
  }

  return {
    phase: 'loading_remote',
    isSettled: false,
    shouldShowBanner: false,
    label: 'Cargando censo',
    message:
      'La app esta cargando el registro diario antes de mostrar pacientes o confirmar vacio.',
    severity: 'info',
  };
};
