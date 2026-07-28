import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { RayenSyncMeta } from '../contracts/rayenDomainContracts';
import type { RayenFillProgress } from '../hooks/useRayenFillStatus';

export type RayenSyncBarPhase =
  | 'idle'
  | 'capture'
  | 'review'
  | 'apply'
  | 'clinical'
  | 'staffing'
  | 'complete'
  | 'action';

export type RayenSyncBarTone = 'neutral' | 'progress' | 'success' | 'warning';

export type RayenSyncBarProgress =
  | { kind: 'indeterminate' }
  | { kind: 'determinate'; done: number; total: number };

export interface RayenSyncBarViewModelInput {
  diff: CensusImportDiff | null;
  fill: RayenFillProgress;
  isApplyingCensus: boolean;
  isPreviewOpen: boolean;
  isSyncing: boolean;
  error: string | null;
  hasPersistedSync: boolean;
  persistedSync?: Pick<RayenSyncMeta, 'status' | 'coverage' | 'staffingObservation'> | null;
  hasSkippedItems?: boolean;
  hasUnresolvedConflicts?: boolean;
}

export interface RayenSyncBarViewModel {
  phase: RayenSyncBarPhase;
  tone: RayenSyncBarTone;
  label: string;
  detail?: string;
  progress?: RayenSyncBarProgress;
  ariaBusy: boolean;
  visuallyHidden: boolean;
}

const changeCount = (diff: CensusImportDiff | null): number =>
  diff
    ? diff.summary.admissions +
      diff.summary.updates +
      diff.summary.moves +
      diff.summary.discharges +
      (diff.reportEgresos?.length ?? 0)
    : 0;

const persistedClinicalSyncHasIssues = (
  persistedSync: RayenSyncBarViewModelInput['persistedSync']
): boolean =>
  persistedSync?.status !== 'complete' ||
  !persistedSync.coverage ||
  persistedSync.coverage.completed !== persistedSync.coverage.total ||
  persistedSync.coverage.errors > 0 ||
  persistedSync.coverage.sourceErrors > 0 ||
  Boolean(persistedSync.coverage.issues?.length);

const persistedStaffingHasIssues = (
  persistedSync: RayenSyncBarViewModelInput['persistedSync']
): boolean => Boolean(persistedSync?.staffingObservation?.ambiguousSections.length);

const settled = (
  phase: RayenSyncBarPhase,
  tone: RayenSyncBarTone,
  label: string,
  options: Pick<RayenSyncBarViewModel, 'detail' | 'visuallyHidden'> = {
    visuallyHidden: false,
  }
): RayenSyncBarViewModel => ({
  phase,
  tone,
  label,
  detail: options.detail,
  ariaBusy: false,
  visuallyHidden: options.visuallyHidden,
});

const active = (
  phase: RayenSyncBarPhase,
  label: string,
  progress: RayenSyncBarProgress
): RayenSyncBarViewModel => ({
  phase,
  tone: 'progress',
  label,
  progress,
  ariaBusy: true,
  visuallyHidden: false,
});

/**
 * Converts the synchronization runtime into one mutually-exclusive operational state.
 * Reconciliation and persistence remain outside this presentation-only model.
 */
export const buildRayenSyncBarViewModel = (
  input: RayenSyncBarViewModelInput
): RayenSyncBarViewModel => {
  const { fill } = input;

  if (input.error) {
    return settled('action', 'warning', 'Sincronización requiere revisión', {
      detail: input.error,
      visuallyHidden: false,
    });
  }
  if (fill.outcome === 'rejected' && fill.running) {
    const hasRealTotal = fill.total > 0;
    const done = hasRealTotal ? Math.min(Math.max(fill.done, 0), fill.total) : 0;
    return active(
      'clinical',
      hasRealTotal
        ? `Sincronización anterior en curso · ${done} de ${fill.total} pacientes`
        : 'Sincronización anterior en curso',
      hasRealTotal ? { kind: 'determinate', done, total: fill.total } : { kind: 'indeterminate' }
    );
  }
  if (fill.outcome === 'rejected') {
    return settled('action', 'warning', 'La información clínica no pudo iniciar');
  }
  if (input.hasUnresolvedConflicts) {
    return settled('action', 'warning', 'Sincronización con conflictos pendientes');
  }
  if (input.hasSkippedItems) {
    return settled('action', 'warning', 'Sincronización con elementos sin aplicar');
  }
  if (fill.staffingOutcome === 'pending') {
    return settled('staffing', 'warning', 'Revisión lista · 1 decisión pendiente');
  }
  if (fill.staffingOutcome === 'ambiguous') {
    return settled('staffing', 'warning', 'Enfermería/TENS sin cambios · evidencia ambigua');
  }
  if (fill.staffingOutcome === 'applying') {
    return active('staffing', 'Aplicando propuesta de enfermería', { kind: 'indeterminate' });
  }
  if (fill.running) {
    const hasRealTotal = fill.total > 0;
    const done = hasRealTotal ? Math.min(Math.max(fill.done, 0), fill.total) : 0;
    return active(
      'clinical',
      hasRealTotal
        ? `Datos clínicos · ${done} de ${fill.total} pacientes`
        : 'Revisando datos clínicos',
      hasRealTotal ? { kind: 'determinate', done, total: fill.total } : { kind: 'indeterminate' }
    );
  }
  if (input.isApplyingCensus) {
    return active('apply', 'Aplicando cambios al censo', { kind: 'indeterminate' });
  }

  const changes = changeCount(input.diff);
  if (input.isPreviewOpen && changes > 0) {
    return settled(
      'review',
      'neutral',
      `${changes} cambio${changes === 1 ? '' : 's'} listo${changes === 1 ? '' : 's'} para revisar`
    );
  }
  if (input.isSyncing) {
    return active('capture', 'Leyendo información de Eloísa', { kind: 'indeterminate' });
  }
  if (fill.staffingOutcome === 'declined') {
    return settled('complete', 'neutral', 'Sincronización completada · se mantuvo HHR');
  }
  if (fill.outcome === 'partial') {
    return settled('action', 'warning', 'Sincronización completada con observaciones');
  }
  if (fill.errors > 0) {
    return settled('action', 'warning', 'Sincronización completada con observaciones');
  }

  if (input.hasPersistedSync) {
    const clinicalIssues = persistedClinicalSyncHasIssues(input.persistedSync);
    const staffingIssues = persistedStaffingHasIssues(input.persistedSync);
    if (clinicalIssues || staffingIssues) {
      if (input.persistedSync?.status === 'applied') {
        return settled('action', 'warning', 'Sincronización pendiente de completar');
      }
      if (!input.persistedSync?.coverage) {
        return settled('action', 'warning', 'Última sincronización sin evidencia clínica');
      }
      return settled('action', 'warning', 'Última sincronización con observaciones');
    }
  }

  if (fill.outcome === 'complete' || input.hasPersistedSync) {
    return settled('complete', 'success', 'Todo al día', {
      visuallyHidden: input.hasPersistedSync,
    });
  }
  return settled('idle', 'neutral', 'Listo para sincronizar');
};
