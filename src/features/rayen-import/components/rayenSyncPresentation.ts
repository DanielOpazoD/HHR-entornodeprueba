import type {
  RayenSyncCoverage,
  RayenSyncEvent,
  RayenSyncFailureReason,
  RayenSyncStatus,
} from '@/types/domain/rayenSync';
import type { RayenExtensionConnectionState } from '../hooks/useRayenExtensionHealth';

export interface CoveragePresentation {
  label: string;
  tone: 'muted' | 'success' | 'warning';
}

export const presentRayenCoverage = (
  coverage: RayenSyncCoverage | undefined,
  hasSync: boolean,
  enrichmentPending = false
): CoveragePresentation => {
  if (!coverage) {
    if (enrichmentPending) return { label: 'Enriquecimiento pendiente', tone: 'warning' };
    return hasSync
      ? { label: 'No disponible en sincronizaciones antiguas', tone: 'muted' }
      : { label: 'Sin sincronización', tone: 'muted' };
  }
  if (coverage.total === 0) return { label: 'Sin cobertura clínica', tone: 'muted' };
  if (coverage.errors > 0) {
    return {
      label: `${coverage.completed}/${coverage.total} · ${coverage.errors} pendiente${coverage.errors === 1 ? '' : 's'}`,
      tone: 'warning',
    };
  }
  if (coverage.sourceErrors > 0) {
    return { label: `${coverage.completed}/${coverage.total} · fuente parcial`, tone: 'warning' };
  }
  return { label: `${coverage.completed}/${coverage.total} completa`, tone: 'success' };
};

export const rayenPrimaryActionLabel = (
  connection: RayenExtensionConnectionState,
  syncing: boolean
): string => {
  if (syncing) return 'Sincronizando…';
  if (connection === 'checking') return 'Comprobando…';
  if (connection === 'ready') return 'Sincronizar';
  if (connection === 'degraded') return 'Sincronizar parcial';
  if (connection === 'blocked') return 'Revisar Ficha Médico';
  if (connection === 'incompatible') return 'Actualizar extensión';
  return 'Comprobar conexión';
};

export const rayenFailureReasonLabel = (reason?: RayenSyncFailureReason): string => {
  if (reason === 'extension_incompatible') return 'Extensión incompatible';
  if (reason === 'ficha_medico_unavailable') return 'Ficha Médico no disponible';
  if (reason === 'snapshot_timeout') return 'Sin respuesta de la extensión';
  if (reason === 'snapshot_error') return 'No se pudo leer Eloísa';
  if (reason === 'apply_failed') return 'No se pudo aplicar el censo';
  return 'Extensión no disponible';
};

export type RayenSyncOutcomeTone = 'success' | 'warning' | 'danger' | 'info';

export interface RayenSyncOutcomePresentation {
  label: string;
  detail: string | null;
  tone: RayenSyncOutcomeTone;
  unresolved: boolean;
}

export const rayenSyncStatusLabel = (status?: RayenSyncStatus): string | null => {
  if (status === 'complete') return 'Completa';
  if (status === 'partial') return 'Parcial';
  if (status === 'applied') return 'Censo aplicado';
  if (status === 'failed') return 'Fallida';
  return null;
};

const partialReasons = (event: RayenSyncEvent): string[] => {
  const reasons: string[] = [];
  if (event.coverage?.errors) {
    reasons.push(
      `${event.coverage.errors} paciente${event.coverage.errors === 1 ? '' : 's'} pendiente${event.coverage.errors === 1 ? '' : 's'}`
    );
  }
  if (event.coverage?.sourceErrors) {
    reasons.push('Fuente clínica incompleta');
  }
  if (event.source?.gestionCamas && event.source.gestionCamas !== 'ready') {
    reasons.push('Gestión de Camas no disponible');
  }
  return reasons;
};

export const presentRayenSyncOutcome = (event: RayenSyncEvent): RayenSyncOutcomePresentation => {
  const label = rayenSyncStatusLabel(event.status) ?? 'Parcial';
  if (event.status === 'complete') {
    return { label, detail: null, tone: 'success', unresolved: false };
  }
  if (event.status === 'failed') {
    return {
      label,
      detail: rayenFailureReasonLabel(event.failureReason),
      tone: 'danger',
      unresolved: true,
    };
  }
  if (event.status === 'applied') {
    return {
      label,
      detail: 'Enriquecimiento clínico pendiente',
      tone: 'info',
      unresolved: true,
    };
  }
  const reasons = partialReasons(event);
  return {
    label,
    detail: reasons.join(' · ') || 'Enriquecimiento clínico parcial',
    tone: 'warning',
    unresolved: true,
  };
};

export interface RayenSyncRecoveryPresentation {
  title: string;
  detail: string;
  action: 'refresh' | 'retry' | null;
  actionLabel: string | null;
  tone: 'warning' | 'danger' | 'info';
}

export const presentRayenSyncRecovery = (
  event: RayenSyncEvent | undefined,
  connection: RayenExtensionConnectionState,
  synchronizationRunning = false
): RayenSyncRecoveryPresentation | null => {
  if (!event) return null;
  const outcome = presentRayenSyncOutcome(event);
  if (!outcome.unresolved) return null;

  if (synchronizationRunning) {
    return {
      title: 'Sincronización en curso',
      detail: outcome.detail ?? 'Completando la ejecución actual.',
      action: null,
      actionLabel: null,
      tone: 'info',
    };
  }

  if (connection === 'checking') {
    return {
      title: 'Comprobando conexión',
      detail: outcome.detail ?? 'Validando si Eloísa está disponible.',
      action: null,
      actionLabel: null,
      tone: 'info',
    };
  }
  if (connection === 'ready') {
    return {
      title: 'Puedes completar esta sincronización',
      detail: `${outcome.detail ?? 'La ejecución quedó pendiente'}. Eloísa está operativa.`,
      action: 'retry',
      actionLabel: 'Reintentar con revisión',
      tone: 'warning',
    };
  }

  const title =
    connection === 'blocked'
      ? 'Ficha Médico requiere atención'
      : connection === 'incompatible'
        ? 'La extensión debe actualizarse'
        : connection === 'degraded'
          ? 'La conexión sigue parcial'
          : 'Eloísa no responde';
  return {
    title,
    detail: outcome.detail ?? 'La ejecución no se completó.',
    action: 'refresh',
    actionLabel: 'Comprobar nuevamente',
    tone: connection === 'blocked' || connection === 'incompatible' ? 'danger' : 'warning',
  };
};
