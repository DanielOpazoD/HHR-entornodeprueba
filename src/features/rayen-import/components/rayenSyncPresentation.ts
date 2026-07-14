import type { RayenSyncCoverage, RayenSyncFailureReason } from '@/types/domain/rayenSync';
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
