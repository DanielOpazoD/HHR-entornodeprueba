import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { RayenSyncMeta } from '../contracts/rayenDomainContracts';
import type { RayenSyncStage } from '../hooks/rayenSyncExecutionState';
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
  error: string | null;
  hasPersistedSync: boolean;
  persistedSync?: Pick<RayenSyncMeta, 'status' | 'coverage' | 'staffingObservation'> | null;
  executionStage?: RayenSyncStage | null;
  targetDate?: string | null;
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
      diff.summary.pendingAdministrativeDischarges +
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

const formatTargetDate = (value?: string | null): string | null => {
  if (!value) return null;
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}-${month}-${year}` : value;
};

const withTargetDate = (label: string, targetDate?: string | null): string => {
  const formatted = formatTargetDate(targetDate);
  return formatted ? `${label} · ${formatted}` : label;
};

const canonicalExecutionViewModel = (
  input: RayenSyncBarViewModelInput
): RayenSyncBarViewModel | null => {
  const stage = input.executionStage;
  if (!stage) return null;
  const targetDate = input.targetDate;

  switch (stage.type) {
    case 'preparing_context':
      return active('capture', withTargetDate('Preparando el contexto del censo', targetDate), {
        kind: 'indeterminate',
      });
    case 'capturing':
      return active('capture', withTargetDate('Leyendo información de Eloísa', targetDate), {
        kind: 'indeterminate',
      });
    case 'planning_structure':
      return active('capture', withTargetDate('Conciliando el censo', targetDate), {
        kind: 'indeterminate',
      });
    case 'awaiting_review': {
      const changes = changeCount(input.diff);
      const label = changes
        ? `${changes} cambio${changes === 1 ? '' : 's'} listo${changes === 1 ? '' : 's'} para revisar`
        : 'Revisión lista';
      return settled('review', 'neutral', withTargetDate(label, targetDate));
    }
    case 'needs_review':
      return settled(
        'action',
        'warning',
        withTargetDate('Sincronización requiere revisión', targetDate),
        { detail: input.error ?? undefined, visuallyHidden: false }
      );
    case 'persisting_structure':
      return active('apply', withTargetDate('Guardando cambios del censo', targetDate), {
        kind: 'indeterminate',
      });
    case 'verifying_structure':
      return active('apply', withTargetDate('Confirmando el censo guardado', targetDate), {
        kind: 'indeterminate',
      });
    case 'syncing_clinical': {
      const hasRealTotal = input.fill.total > 0;
      const done = hasRealTotal ? Math.min(Math.max(input.fill.done, 0), input.fill.total) : 0;
      return active(
        'clinical',
        withTargetDate(
          hasRealTotal
            ? `Datos clínicos · ${done} de ${input.fill.total} pacientes`
            : 'Revisando datos clínicos',
          targetDate
        ),
        hasRealTotal
          ? { kind: 'determinate', done, total: input.fill.total }
          : { kind: 'indeterminate' }
      );
    }
    case 'complete':
      return settled('complete', 'success', withTargetDate('Todo al día', targetDate));
    case 'partial':
      return settled(
        'action',
        'warning',
        withTargetDate('Información clínica pendiente de completar', targetDate),
        { detail: input.error ?? undefined, visuallyHidden: false }
      );
    case 'failed':
      return settled(
        'action',
        'warning',
        withTargetDate('Sincronización requiere revisión', targetDate),
        { detail: input.error ?? undefined, visuallyHidden: false }
      );
    case 'cancelled':
      return settled('idle', 'neutral', withTargetDate('Sincronización cancelada', targetDate));
  }
};

/**
 * Converts the synchronization runtime into one mutually-exclusive operational state.
 * Reconciliation and persistence remain outside this presentation-only model.
 */
export const buildRayenSyncBarViewModel = (
  input: RayenSyncBarViewModelInput
): RayenSyncBarViewModel => {
  const canonical = canonicalExecutionViewModel(input);
  if (canonical) return canonical;

  // A shared clinical fill can outlive the component that started it. Keep it visible and
  // actionable after remounting, while the contextual execution remains the primary source.
  if (input.fill.running) {
    const hasRealTotal = input.fill.total > 0;
    const done = hasRealTotal ? Math.min(Math.max(input.fill.done, 0), input.fill.total) : 0;
    return active(
      'clinical',
      withTargetDate(
        hasRealTotal
          ? `Datos clínicos · ${done} de ${input.fill.total} pacientes`
          : 'Revisando datos clínicos',
        input.targetDate
      ),
      hasRealTotal
        ? { kind: 'determinate', done, total: input.fill.total }
        : { kind: 'indeterminate' }
    );
  }

  if (input.hasPersistedSync) {
    const clinicalIssues = persistedClinicalSyncHasIssues(input.persistedSync);
    if (clinicalIssues) {
      if (input.persistedSync?.status === 'applied') {
        return settled('action', 'warning', 'Sincronización pendiente de completar');
      }
      if (!input.persistedSync?.coverage) {
        return settled('action', 'warning', 'Última sincronización sin evidencia clínica');
      }
      return settled('action', 'warning', 'Última sincronización con observaciones');
    }
  }

  if (input.hasPersistedSync) {
    return settled('complete', 'success', 'Todo al día', {
      visuallyHidden: input.hasPersistedSync,
    });
  }
  return settled('idle', 'neutral', 'Listo para sincronizar');
};
