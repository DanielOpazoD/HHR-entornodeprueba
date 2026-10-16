import React from 'react';
import { AlertTriangle, CheckCircle2, CircleX, Clock3, History } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';
import {
  presentRayenSyncOutcome,
  formatRayenSyncDuration,
  formatRayenSyncIslandTime,
  formatRayenSyncTargetDate,
  rayenFailureReasonLabel,
} from './rayenSyncPresentation';
import { type RayenSyncRecoveryPresentation } from './rayenSyncRecoveryPresentation';
import { RayenSyncRecoveryNotice } from './RayenSyncRecoveryNotice';
import { RayenSyncClinicalSection } from './RayenSyncHistorySections';
import { RayenSyncSessionReportButton } from './RayenSyncSessionReportButton';
import { RayenSyncIssueActions } from './RayenSyncIssueActions';
import { rayenSyncTechnicalCode } from './rayenSyncIssueSupport';

interface RayenSyncHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: RayenSyncEvent[];
  recovery: RayenSyncRecoveryPresentation | null;
  recoveryBusy: boolean;
  onRecoveryAction: () => void;
  targetDate?: string | null;
}

const statusPresentation = (event: RayenSyncEvent) => {
  const outcome = presentRayenSyncOutcome(event);
  if (outcome.tone === 'success') {
    return {
      label: outcome.label,
      icon: <CheckCircle2 size={15} aria-hidden="true" />,
      className: 'text-emerald-700',
    };
  }
  if (outcome.tone === 'warning') {
    return {
      label: outcome.label,
      icon: <AlertTriangle size={15} aria-hidden="true" />,
      className: 'text-amber-700',
    };
  }
  if (outcome.tone === 'danger') {
    return {
      label: outcome.label,
      icon: <CircleX size={15} aria-hidden="true" />,
      className: 'text-red-700',
    };
  }
  return {
    label: outcome.label,
    icon: <Clock3 size={15} aria-hidden="true" />,
    className: 'text-slate-500',
  };
};

const changesLabel = (event: RayenSyncEvent): string => {
  if (!event.changes) return 'Sin resumen de cambios';
  const { admissions, updates, moves, discharges } = event.changes;
  if (admissions + updates + moves + discharges === 0) {
    return 'Sin cambios de camas, ingresos ni egresos.';
  }
  return [
    [admissions, 'ingresos'],
    [updates, 'actualizaciones'],
    [moves, 'movimientos'],
    [discharges, 'egresos'],
  ]
    .filter(([count]) => Number(count) > 0)
    .map(([count, label]) => `${count} ${label}`)
    .join(' · ');
};

const isQuietSuccessfulRun = (event: RayenSyncEvent): boolean => {
  const changes = event.changes;
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
    !event.structuralReview?.deferredHistoricalAdmissionBedIds?.length &&
    !event.staffingObservation
  );
};

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

const QuietHistoryGroup: React.FC<{ events: RayenSyncEvent[] }> = ({ events }) => {
  const newest = events[0];
  const oldest = events.at(-1) ?? newest;
  const timeLabel =
    events.length === 1
      ? formatRayenSyncIslandTime(newest.startedAt)
      : `${formatRayenSyncIslandTime(oldest.startedAt)}–${formatRayenSyncIslandTime(newest.startedAt)}`;
  return (
    <li className="border-b border-slate-200 py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-bold tabular-nums text-slate-700">
          <Clock3 size={13} aria-hidden="true" />
          {timeLabel}
          <span className="font-medium text-slate-400" aria-hidden="true">
            ·
          </span>
          <span className="truncate font-semibold text-slate-500">{newest.by}</span>
        </p>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-700">
          <CheckCircle2 size={14} aria-hidden="true" />
          Completa
        </span>
      </div>
      <p className="mt-1 text-sm font-semibold text-slate-600">
        {events.length} {events.length === 1 ? 'comprobación' : 'comprobaciones'} sin cambios
      </p>
      <RayenSyncClinicalSection event={newest} />
    </li>
  );
};

const HistoryEvent: React.FC<{
  event: RayenSyncEvent;
  latest: boolean;
  targetDate?: string | null;
}> = ({ event, latest, targetDate }) => {
  const status = statusPresentation(event);
  const outcome = presentRayenSyncOutcome(event);
  const duration = formatRayenSyncDuration(event.startedAt, event.completedAt);
  return (
    <li className="border-b border-slate-200 py-3 last:border-0">
      {latest && (
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-teal-700">
          Última sincronización
        </p>
      )}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-bold tabular-nums text-slate-800">
            <Clock3 size={13} aria-hidden="true" />
            {formatRayenSyncIslandTime(event.startedAt)}
            <span className="font-medium text-slate-400" aria-hidden="true">
              ·
            </span>
            <span className="truncate font-semibold text-slate-600">{event.by}</span>
          </p>
          <p className="mt-1 text-sm font-medium text-slate-600">
            {event.status === 'failed'
              ? rayenFailureReasonLabel(event.failureReason)
              : changesLabel(event)}
          </p>
          {event.status !== 'failed' && outcome.detail && (
            <p
              className={`mt-1 text-sm font-semibold ${
                outcome.tone === 'warning' ? 'text-amber-700' : 'text-sky-700'
              }`}
            >
              {outcome.detail}
            </p>
          )}
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold ${status.className}`}
        >
          {status.icon}
          {status.label}
        </span>
      </div>

      {duration && <p className="mt-1 text-xs tabular-nums text-slate-500">Duración {duration}</p>}
      {(event.status === 'failed' ||
        (event.status === 'partial' &&
          !event.coverage?.issues?.length &&
          !event.structuralReview?.issues?.length)) && (
        <RayenSyncIssueActions
          code={rayenSyncTechnicalCode(
            'run',
            event.status === 'failed' ? (event.failureReason ?? 'unspecified') : 'partial'
          )}
        />
      )}
      <RayenSyncClinicalSection event={event} targetDate={targetDate} />
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
  targetDate,
}) => {
  const items = React.useMemo(() => groupHistory(history), [history]);
  const formattedTargetDate = formatRayenSyncTargetDate(targetDate);
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={`Historial de sincronización · ${formattedTargetDate}`}
      icon={<History size={19} />}
      size="xl"
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
      {history.length > 0 && <RayenSyncSessionReportButton history={history} />}
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
        <ol className="pr-1" aria-label={`Sincronizaciones del censo ${formattedTargetDate}`}>
          {items.map((item, index) =>
            item.kind === 'quiet' ? (
              <QuietHistoryGroup key={`quiet-${item.events[0].id}`} events={item.events} />
            ) : (
              <HistoryEvent
                key={item.event.id}
                event={item.event}
                latest={index === 0}
                targetDate={targetDate}
              />
            )
          )}
        </ol>
      )}
    </BaseModal>
  );
};
