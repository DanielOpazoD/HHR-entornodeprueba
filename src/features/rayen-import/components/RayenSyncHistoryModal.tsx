import React from 'react';
import { AlertTriangle, CheckCircle2, CircleX, Clock3, History } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';
import {
  presentRayenCoverage,
  presentRayenSyncOutcome,
  presentRayenCoverageIssue,
  formatRayenSyncDuration,
  rayenFailureReasonLabel,
  type RayenSyncRecoveryPresentation,
} from './rayenSyncPresentation';
import { RayenSyncRecoveryNotice } from './RayenSyncRecoveryNotice';
import { StaffingBoundaryExclusions } from './StaffingBoundaryExclusions';
import { RayenSyncTechnicalMetricsPanel } from './RayenSyncTechnicalMetricsPanel';

interface RayenSyncHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: RayenSyncEvent[];
  recovery: RayenSyncRecoveryPresentation | null;
  recoveryBusy: boolean;
  onRecoveryAction: () => void;
}

const formatIslandTime = (iso: string): string => {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return 'Hora no disponible';
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'Pacific/Easter',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(value);
};

const statusPresentation = (event: RayenSyncEvent) => {
  const outcome = presentRayenSyncOutcome(event);
  if (outcome.tone === 'success') {
    return {
      label: outcome.label,
      icon: <CheckCircle2 size={15} aria-hidden="true" />,
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    };
  }
  if (outcome.tone === 'warning') {
    return {
      label: outcome.label,
      icon: <AlertTriangle size={15} aria-hidden="true" />,
      className: 'border-amber-200 bg-amber-50 text-amber-700',
    };
  }
  if (outcome.tone === 'danger') {
    return {
      label: outcome.label,
      icon: <CircleX size={15} aria-hidden="true" />,
      className: 'border-red-200 bg-red-50 text-red-700',
    };
  }
  return {
    label: outcome.label,
    icon: <Clock3 size={15} aria-hidden="true" />,
    className: 'border-sky-200 bg-sky-50 text-sky-700',
  };
};

const changesLabel = (event: RayenSyncEvent): string => {
  if (!event.changes) return 'Sin resumen de cambios';
  return `Sincronizado: ${event.changes.admissions} ingresos, ${event.changes.updates} act., ${event.changes.moves} mov., ${event.changes.discharges} egresos`;
};

const sourceLabel = (event: RayenSyncEvent): string | null => {
  const source = event.source;
  if (!source) return null;
  const version = source.extensionVersion ? `Ext. v${source.extensionVersion}` : 'Extensión';
  const ficha = source.fichaMedico === 'ready' ? 'Ficha ✓' : 'Ficha —';
  const camas = source.gestionCamas === 'ready' ? 'Camas ✓' : 'Camas —';
  return `${version} · ${ficha} · ${camas}`;
};

const isQuietSuccessfulRun = (event: RayenSyncEvent): boolean => {
  const changes = event.changes;
  // Telemetry-bearing runs remain individually inspectable; only legacy quiet runs are grouped.
  if (!changes || event.status !== 'complete' || !event.coverage || event.performance) return false;
  const outcome = presentRayenSyncOutcome(event);
  const hasChanges = changes.admissions + changes.updates + changes.moves + changes.discharges > 0;
  const hasCoverageIssues =
    event.coverage.completed !== event.coverage.total ||
    Boolean(event.coverage?.errors) ||
    Boolean(event.coverage?.sourceErrors) ||
    Boolean(event.coverage?.issues?.length);
  return (
    !outcome.unresolved &&
    !outcome.detail &&
    !hasChanges &&
    !hasCoverageIssues &&
    !event.staffingObservation
  );
};

const STAFFING_SECTION_LABELS = {
  nurse_day: 'Enfermería · turno día',
  nurse_night: 'Enfermería · turno noche',
  tens_day: 'TENS · turno largo',
  tens_night: 'TENS · turno noche',
} as const;

const quietRunSignature = (event: RayenSyncEvent): string =>
  [
    event.by,
    event.coverage?.total ?? '',
    event.coverage?.completed ?? '',
    event.source?.extensionVersion ?? '',
    event.source?.fichaMedico ?? '',
    event.source?.gestionCamas ?? '',
    event.coverage?.incremental?.patientWrites ?? '',
    event.coverage?.incremental?.duplicates ?? '',
  ].join('|');

type HistoryListItem =
  | { kind: 'event'; event: RayenSyncEvent }
  | { kind: 'quiet'; events: RayenSyncEvent[] };

const groupHistory = (history: RayenSyncEvent[]): HistoryListItem[] => {
  const items: HistoryListItem[] = [];
  for (const event of history) {
    if (!isQuietSuccessfulRun(event)) {
      items.push({ kind: 'event', event });
      continue;
    }
    const previous = items.at(-1);
    if (
      previous?.kind === 'quiet' &&
      quietRunSignature(previous.events[0]) === quietRunSignature(event)
    ) {
      previous.events.push(event);
    } else {
      items.push({ kind: 'quiet', events: [event] });
    }
  }
  return items;
};

const HistoryMetadata: React.FC<{ event: RayenSyncEvent }> = ({ event }) => {
  const coverage = presentRayenCoverage(
    event.coverage,
    event.status !== 'failed',
    event.status === 'applied'
  );
  const source = sourceLabel(event);
  const duration = formatRayenSyncDuration(event.startedAt, event.completedAt);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[11px]">
      {event.status !== 'failed' && (
        <span
          title="Cobertura técnica del enriquecimiento clínico; no incluye la disponibilidad de Gestión de Camas"
          className={
            coverage.tone === 'success'
              ? 'font-semibold text-emerald-700'
              : coverage.tone === 'warning'
                ? 'font-semibold text-amber-700'
                : 'font-medium text-slate-500'
          }
        >
          Cobertura clínica: {coverage.label}
        </span>
      )}
      {source && <span className="font-medium text-slate-400">{source}</span>}
      {duration && (
        <span className="font-medium tabular-nums text-slate-500">Duración {duration}</span>
      )}
      {event.coverage?.incremental && (
        <span
          className="font-medium tabular-nums text-slate-500"
          title="Resumen agregado; no contiene nombres, RUT ni valores clínicos"
        >
          Incremental: {event.coverage.incremental.newFacts} nuevos ·{' '}
          {event.coverage.incremental.duplicates} ya conocidos ·{' '}
          {event.coverage.incremental.corrections} corregidos ·{' '}
          {event.coverage.incremental.patientWrites} escrituras
        </span>
      )}
      {event.coverage?.incremental?.batch && (
        <span
          className="font-medium tabular-nums text-slate-500"
          title="Comparación agregada del lote transaccional; no contiene datos clínicos"
        >
          Lote {event.coverage.incremental.batch.mode}:{' '}
          {event.coverage.incremental.batch.parity === 'matched'
            ? 'paridad confirmada'
            : event.coverage.incremental.batch.parity === 'mismatch'
              ? 'paridad no confirmada'
              : 'sin evidencia'}{' '}
          · {event.coverage.incremental.batch.clinicalTargets} clínicos ·{' '}
          {event.coverage.incremental.batch.checkpointOnlyTargets} sólo checkpoint
        </span>
      )}
    </div>
  );
};

const QuietHistoryGroup: React.FC<{ events: RayenSyncEvent[] }> = ({ events }) => {
  const newest = events[0];
  const oldest = events.at(-1) ?? newest;
  const timeLabel =
    events.length === 1
      ? formatIslandTime(newest.startedAt)
      : `${formatIslandTime(oldest.startedAt)}–${formatIslandTime(newest.startedAt)}`;
  return (
    <li className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-bold tabular-nums text-slate-700">
          <Clock3 size={13} aria-hidden="true" />
          {timeLabel}
          <span className="font-medium text-slate-400" aria-hidden="true">
            ·
          </span>
          <span className="truncate font-semibold text-slate-500">{newest.by}</span>
        </p>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
          <CheckCircle2 size={14} aria-hidden="true" />
          Completa
        </span>
      </div>
      <p className="mt-1 text-xs font-semibold text-slate-600">
        {events.length} {events.length === 1 ? 'comprobación' : 'comprobaciones'} sin cambios
      </p>
      <HistoryMetadata event={newest} />
      <RayenSyncTechnicalMetricsPanel performance={newest.performance} />
    </li>
  );
};

const HistoryEvent: React.FC<{ event: RayenSyncEvent }> = ({ event }) => {
  const status = statusPresentation(event);
  const outcome = presentRayenSyncOutcome(event);
  const staffingNeedsReview = Boolean(event.staffingObservation?.ambiguousSections.length);
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-bold tabular-nums text-slate-800">
            <Clock3 size={13} aria-hidden="true" />
            {formatIslandTime(event.startedAt)}
            <span className="font-medium text-slate-400" aria-hidden="true">
              ·
            </span>
            <span className="truncate font-semibold text-slate-600">{event.by}</span>
          </p>
          <p className="mt-1 text-xs font-medium text-slate-600">
            {event.status === 'failed'
              ? rayenFailureReasonLabel(event.failureReason)
              : changesLabel(event)}
          </p>
          {event.status !== 'failed' && outcome.detail && (
            <p
              className={`mt-1 text-[11px] font-semibold ${
                outcome.tone === 'warning' ? 'text-amber-700' : 'text-sky-700'
              }`}
            >
              {outcome.detail}
            </p>
          )}
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold ${status.className}`}
        >
          {status.icon}
          {status.label}
        </span>
      </div>

      <HistoryMetadata event={event} />
      <RayenSyncTechnicalMetricsPanel performance={event.performance} />
      {event.staffingObservation && (
        <div
          data-testid="rayen-staffing-observation"
          className={`mt-2 rounded-lg border px-2.5 py-2 text-[11px] ${
            staffingNeedsReview
              ? 'border-amber-200 bg-amber-50 text-amber-900'
              : 'border-slate-200 bg-slate-50 text-slate-700'
          }`}
        >
          <p className="font-bold">
            {staffingNeedsReview
              ? 'Enfermería / TENS · requiere revisión'
              : 'Enfermería / TENS · relevo gestionado'}
          </p>
          {staffingNeedsReview && (
            <p className="mt-1">
              HHR no modificó la dotación porque la evidencia fue insuficiente, empatada o presentó
              identidades incompatibles en:{' '}
              {event.staffingObservation.ambiguousSections
                .map(section => STAFFING_SECTION_LABELS[section])
                .join(', ')}
              .
            </p>
          )}
          {event.staffingObservation.ignoredBoundaryRecords > 0 && (
            <>
              <p className="mt-1">
                HHR detectó {event.staffingObservation.ignoredBoundaryRecords}{' '}
                {event.staffingObservation.ignoredBoundaryRecords === 1 ? 'firma' : 'firmas'} cerca
                del cambio de turno y las conservó como trazabilidad sin usarlas para reemplazar la
                dotación.{' '}
                {!staffingNeedsReview &&
                  'Es un comportamiento esperado y la sincronización sigue completa.'}
              </p>
              <StaffingBoundaryExclusions
                total={event.staffingObservation.ignoredBoundaryRecords}
                evidence={event.staffingObservation.ignoredBoundaryEvidence ?? []}
                tone={staffingNeedsReview ? 'warning' : 'neutral'}
              />
            </>
          )}
        </div>
      )}
      {event.coverage && (event.coverage.errors > 0 || Boolean(event.coverage.issues?.length)) && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
          <p className="font-bold">Detalle para resolver</p>
          {event.coverage.issues?.length ? (
            <ul className="mt-1 space-y-1">
              {event.coverage.issues.map(issue => (
                <li key={`${issue.bedId}-${issue.source}-${issue.reason}`}>
                  {presentRayenCoverageIssue(issue)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1">
              Esta ejecución no registró el paciente ni la etapa que falló. Usa “Reintentar con
              revisión”; la nueva ejecución mostrará cama, fuente y causa si vuelve a ocurrir.
            </p>
          )}
        </div>
      )}
    </li>
  );
};

export const RayenSyncHistoryModal: React.FC<RayenSyncHistoryModalProps> = ({
  isOpen,
  onClose,
  history,
  recovery,
  recoveryBusy,
  onRecoveryAction,
}) => {
  const items = React.useMemo(() => groupHistory(history), [history]);
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Historial de sincronización · hoy"
      icon={<History size={19} />}
      size="lg"
      variant="white"
      headerIconColor="text-teal-700"
      dataModule="rayen-import"
      dataTestId="rayen-sync-history-modal"
    >
      <RayenSyncRecoveryNotice
        presentation={recovery}
        busy={recoveryBusy}
        onAction={onRecoveryAction}
      />
      {history.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
          <History className="mx-auto text-slate-300" size={24} aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-slate-700">
            Sin sincronizaciones registradas
          </p>
          <p className="mt-1 text-xs text-slate-500">
            La próxima sincronización iniciada manualmente quedará registrada aquí.
          </p>
        </div>
      ) : (
        <ol
          className="max-h-[58vh] space-y-2 overflow-y-auto pr-1"
          aria-label="Sincronizaciones de hoy"
        >
          {items.map(item =>
            item.kind === 'quiet' ? (
              <QuietHistoryGroup key={`quiet-${item.events[0].id}`} events={item.events} />
            ) : (
              <HistoryEvent key={item.event.id} event={item.event} />
            )
          )}
        </ol>
      )}
    </BaseModal>
  );
};
