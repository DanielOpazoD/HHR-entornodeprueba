import React from 'react';
import {
  Activity,
  Check,
  Circle,
  Gauge,
  LoaderCircle,
  MonitorCog,
  UserRoundCheck,
  type LucideIcon,
} from 'lucide-react';
import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { RayenFillProgress } from '../hooks/useRayenFillStatus';
import type { RayenSyncMeta } from '../contracts/rayenDomainContracts';

interface RayenImportFlowStatusProps {
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

type ModuleState = 'waiting' | 'running' | 'complete' | 'attention' | 'warning';

interface ModulePresentation {
  label: string;
  detail: string;
  state: ModuleState;
  icon: LucideIcon;
}

const persistedClinicalSyncHasIssues = (
  persistedSync: RayenImportFlowStatusProps['persistedSync']
): boolean =>
  persistedSync?.status !== 'complete' ||
  !persistedSync.coverage ||
  persistedSync.coverage.completed !== persistedSync.coverage.total ||
  Boolean(persistedSync?.coverage?.errors) ||
  Boolean(persistedSync?.coverage?.sourceErrors) ||
  Boolean(persistedSync?.coverage?.issues?.length);

const persistedSyncHasIssues = (
  persistedSync: RayenImportFlowStatusProps['persistedSync']
): boolean =>
  persistedClinicalSyncHasIssues(persistedSync) || Boolean(persistedSync?.staffingObservation);

const persistedSyncIsComplete = ({
  hasPersistedSync,
  persistedSync,
}: Pick<RayenImportFlowStatusProps, 'hasPersistedSync' | 'persistedSync'>): boolean =>
  hasPersistedSync && !persistedSyncHasIssues(persistedSync);

const changeCount = (diff: CensusImportDiff | null): number =>
  diff
    ? diff.summary.admissions +
      diff.summary.updates +
      diff.summary.moves +
      diff.summary.discharges +
      (diff.reportEgresos?.length ?? 0)
    : 0;

const progressPercentage = ({
  diff,
  fill,
  isApplyingCensus,
  isPreviewOpen,
  isSyncing,
  hasPersistedSync,
  persistedSync,
}: Omit<RayenImportFlowStatusProps, 'error'>): number => {
  if (fill.outcome === 'rejected') return 0;
  if (fill.staffingOutcome === 'pending') return 96;
  if (fill.staffingOutcome === 'applying') return 98;
  if (fill.outcome === 'complete' || fill.outcome === 'partial') return 100;
  if (fill.running) {
    const clinicalPercent = fill.total > 0 ? fill.done / fill.total : 0;
    return Math.round(42 + clinicalPercent * 52);
  }
  if (isApplyingCensus) return 38;
  if (isPreviewOpen && diff) return 26;
  if (isSyncing) return 16;
  if (!hasPersistedSync) return 0;
  return persistedSync?.status === 'applied' ? 42 : 100;
};

const moduleIconClass = (state: ModuleState): string => {
  if (state === 'running') return 'animate-spin text-teal-600 motion-reduce:animate-none';
  if (state === 'complete') return 'text-emerald-600';
  if (state === 'attention') return 'text-amber-600';
  if (state === 'warning') return 'text-amber-600';
  return 'text-slate-300';
};

const stateIcon = (state: ModuleState) =>
  state === 'running' ? LoaderCircle : state === 'complete' ? Check : Circle;

const moduleBadgeClass = (state: ModuleState): string => {
  if (state === 'complete') return 'bg-emerald-100';
  if (state === 'attention' || state === 'warning') return 'bg-amber-100';
  if (state === 'running') return 'bg-teal-100';
  return 'bg-slate-100';
};

const buildModules = ({
  diff,
  fill,
  isApplyingCensus,
  isPreviewOpen,
  isSyncing,
  hasPersistedSync,
  persistedSync,
  hasSkippedItems,
  hasUnresolvedConflicts,
}: Omit<RayenImportFlowStatusProps, 'error'>): ModulePresentation[] => {
  const changes = changeCount(diff);
  const reviewPending = isPreviewOpen && Boolean(diff) && !isApplyingCensus;
  const clinicalRunning = fill.running;
  const clinicalSettled = fill.outcome === 'complete' || fill.outcome === 'partial';
  const clinicalWarning = fill.outcome === 'partial' || fill.errors > 0;
  const nursingAttention =
    fill.staffingOutcome === 'pending' || fill.staffingOutcome === 'ambiguous';
  const persistedComplete = persistedSyncIsComplete({ hasPersistedSync, persistedSync });
  const persistedWarning = hasPersistedSync && !persistedComplete;
  const persistedClinicalWarning =
    hasPersistedSync && persistedClinicalSyncHasIssues(persistedSync);
  const persistedClinicalComplete = hasPersistedSync && !persistedClinicalWarning;
  const persistedWarningDetail =
    persistedSync?.status === 'applied'
      ? 'Pendiente'
      : !persistedSync?.coverage
        ? 'Sin evidencia'
        : 'Con observaciones';

  const censusState: ModuleState =
    hasSkippedItems || hasUnresolvedConflicts
      ? 'warning'
      : isApplyingCensus
        ? 'running'
        : reviewPending
          ? changes > 0
            ? 'attention'
            : 'complete'
          : clinicalRunning || clinicalSettled
            ? 'complete'
            : isSyncing
              ? 'running'
              : hasPersistedSync
                ? 'complete'
                : 'waiting';

  const clinicalState: ModuleState = clinicalRunning
    ? 'running'
    : clinicalSettled
      ? clinicalWarning
        ? 'warning'
        : 'complete'
      : persistedClinicalWarning && !isSyncing
        ? 'warning'
        : persistedClinicalComplete && !isSyncing
          ? 'complete'
          : 'waiting';

  const nursingState: ModuleState =
    fill.staffingOutcome === 'applying'
      ? 'running'
      : nursingAttention
        ? 'attention'
        : fill.staffingOutcome === 'declined'
          ? 'warning'
          : persistedWarning && !isSyncing
            ? 'warning'
            : clinicalSettled || (persistedComplete && !isSyncing)
              ? 'complete'
              : 'waiting';

  const censusDetail = isApplyingCensus
    ? 'Actualizando'
    : reviewPending && changes > 0
      ? `${changes} cambio${changes === 1 ? '' : 's'} por revisar`
      : censusState === 'warning'
        ? 'Con observaciones'
        : censusState === 'complete'
          ? 'Verificado'
          : isSyncing
            ? 'Leyendo Eloísa'
            : 'En espera';
  const clinicalDetail = clinicalRunning
    ? 'Comprobando'
    : clinicalWarning
      ? fill.errors > 0
        ? `${fill.errors} con observación`
        : 'Con observaciones'
      : clinicalState === 'warning'
        ? persistedWarningDetail
        : clinicalState === 'complete'
          ? 'Verificado'
          : 'En espera';
  const nursingDetail =
    fill.staffingOutcome === 'applying'
      ? 'Aplicando'
      : fill.staffingOutcome === 'pending'
        ? 'Requiere revisión'
        : fill.staffingOutcome === 'ambiguous'
          ? 'Con observación'
          : fill.staffingOutcome === 'declined'
            ? 'Se mantuvo HHR'
            : nursingState === 'warning'
              ? persistedWarningDetail
              : nursingState === 'complete'
                ? 'Verificada'
                : 'En espera';

  return [
    { label: 'Censo', detail: censusDetail, state: censusState, icon: MonitorCog },
    { label: 'Signos vitales', detail: clinicalDetail, state: clinicalState, icon: Activity },
    { label: 'Dispositivos', detail: clinicalDetail, state: clinicalState, icon: MonitorCog },
    { label: 'Scores', detail: clinicalDetail, state: clinicalState, icon: Gauge },
    {
      label: 'Enfermería / TENS',
      detail: nursingDetail,
      state: nursingState,
      icon: UserRoundCheck,
    },
  ];
};

const mainLabel = (props: RayenImportFlowStatusProps, percent: number, changes: number): string => {
  const { error, fill, isApplyingCensus, isPreviewOpen, isSyncing, hasPersistedSync } = props;
  if (error) return 'La sincronización requiere atención';
  if (fill.outcome === 'rejected') return 'La información clínica no pudo iniciar';
  if (fill.staffingOutcome === 'pending') return 'Revisión lista · 1 decisión pendiente';
  if (fill.staffingOutcome === 'ambiguous')
    return 'Enfermería/TENS sin cambios · evidencia ambigua';
  if (fill.staffingOutcome === 'applying') return 'Aplicando propuesta de enfermería';
  if (props.hasUnresolvedConflicts) return 'Sincronización con conflictos pendientes';
  if (props.hasSkippedItems) return 'Sincronización con elementos sin aplicar';
  if (fill.running) return `Revisando información clínica · ${percent}%`;
  if (isApplyingCensus) return 'Actualizando censo y demografía';
  if (isPreviewOpen && changes > 0)
    return `${changes} cambio${changes === 1 ? '' : 's'} listo${changes === 1 ? '' : 's'} para revisar`;
  if (isSyncing) return 'Leyendo información de Eloísa';
  if (fill.staffingOutcome === 'declined') return 'Sincronización completada · se mantuvo HHR';
  if (fill.outcome === 'partial') return 'Sincronización completada con observaciones';
  if (hasPersistedSync && persistedSyncHasIssues(props.persistedSync)) {
    if (props.persistedSync?.status === 'applied') return 'Sincronización pendiente de completar';
    if (!props.persistedSync?.coverage) return 'Última sincronización sin evidencia clínica';
    return 'Última sincronización con observaciones';
  }
  if (fill.outcome === 'complete' || persistedSyncIsComplete(props)) return 'Todo al día';
  return 'Listo para sincronizar';
};

export const RayenImportFlowStatus: React.FC<RayenImportFlowStatusProps> = props => {
  const progressInput = {
    diff: props.diff,
    fill: props.fill,
    isApplyingCensus: props.isApplyingCensus,
    isPreviewOpen: props.isPreviewOpen,
    isSyncing: props.isSyncing,
    hasPersistedSync: props.hasPersistedSync,
    persistedSync: props.persistedSync,
    hasSkippedItems: props.hasSkippedItems,
    hasUnresolvedConflicts: props.hasUnresolvedConflicts,
  };
  const percent = progressPercentage(progressInput);
  const modules = buildModules(progressInput);
  const changes = changeCount(props.diff);
  const label = mainLabel(props, percent, changes);
  const showProgress =
    props.isSyncing ||
    props.isApplyingCensus ||
    props.fill.running ||
    props.fill.staffingOutcome === 'applying';
  const settledSuccess =
    !props.error &&
    !showProgress &&
    !props.isPreviewOpen &&
    !props.hasSkippedItems &&
    !props.hasUnresolvedConflicts &&
    props.fill.outcome !== 'partial' &&
    props.fill.outcome !== 'rejected' &&
    props.fill.errors === 0 &&
    props.fill.staffingOutcome !== 'pending' &&
    props.fill.staffingOutcome !== 'ambiguous' &&
    props.fill.staffingOutcome !== 'declined' &&
    (props.fill.outcome === 'complete' || persistedSyncIsComplete(props));
  const statusTone =
    props.error ||
    props.hasSkippedItems ||
    props.hasUnresolvedConflicts ||
    props.fill.outcome === 'partial' ||
    props.fill.outcome === 'rejected' ||
    props.fill.staffingOutcome === 'pending' ||
    props.fill.staffingOutcome === 'ambiguous' ||
    (props.hasPersistedSync && !persistedSyncIsComplete(props))
      ? 'text-amber-700'
      : showProgress
        ? 'text-teal-700'
        : 'text-slate-500';

  return (
    <section
      className="relative min-w-0 px-1 xl:border-l xl:border-slate-200 xl:pl-3"
      aria-label="Estado de sincronización con Eloísa"
      data-testid="rayen-sync-pulse"
    >
      <div className="grid grid-cols-2 gap-x-2 gap-y-1 sm:grid-cols-3 xl:grid-cols-5 xl:gap-x-2">
        {modules.map(module => {
          const StatusIcon = stateIcon(module.state);
          const ModuleIcon = module.icon;
          return (
            <div
              key={module.label}
              className="flex min-w-0 items-center justify-start gap-1.5 xl:justify-center"
              title={`${module.label}: ${module.detail}`}
            >
              <span
                className={`inline-flex size-4 shrink-0 items-center justify-center rounded-full ${moduleBadgeClass(module.state)}`}
                aria-hidden="true"
              >
                {module.state === 'waiting' ? (
                  <ModuleIcon size={10} className="text-slate-400" aria-hidden="true" />
                ) : (
                  <StatusIcon
                    size={10}
                    className={moduleIconClass(module.state)}
                    aria-hidden="true"
                  />
                )}
              </span>
              <p className="truncate text-[11px] font-semibold leading-4 text-slate-700">
                {module.label}
              </p>
              <span className="sr-only">: {module.detail}</span>
            </div>
          );
        })}
      </div>

      {showProgress && (
        <div className="mt-1.5 flex items-center gap-2">
          <div
            className="relative h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            aria-label="Progreso de sincronización con Eloísa"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={`${percent}% · ${label}`}
          >
            <span
              className="block h-full rounded-full bg-teal-600 transition-[width] duration-500 ease-out motion-reduce:transition-none"
              style={{ width: `${percent}%` }}
              aria-hidden="true"
            />
            <span
              className="absolute inset-y-0 w-8 animate-pulse rounded-full bg-teal-300/70 motion-reduce:animate-none"
              style={{ left: `max(0px, calc(${percent}% - 2rem))` }}
              aria-hidden="true"
            />
          </div>
          <span className="w-8 shrink-0 text-right text-[10px] font-bold tabular-nums text-teal-700">
            {percent}%
          </span>
        </div>
      )}
      <p
        className={
          settledSuccess ? 'sr-only' : `mt-1 truncate text-[10px] font-semibold ${statusTone}`
        }
        role="status"
        aria-live="polite"
      >
        {label}
      </p>
    </section>
  );
};
