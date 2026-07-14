import React from 'react';
import { AlertTriangle, CheckCircle2, CircleX, Clock3, History } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { RayenSyncEvent } from '@/types/domain/rayenSync';
import { rayenSyncChangeCount } from '../domain/rayenSyncHistory';
import {
  presentRayenCoverage,
  presentRayenSyncOutcome,
  rayenFailureReasonLabel,
  type RayenSyncRecoveryPresentation,
} from './rayenSyncPresentation';
import { RayenSyncRecoveryNotice } from './RayenSyncRecoveryNotice';

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
  if (rayenSyncChangeCount(event) === 0) return 'Sin cambios en el censo';
  const parts = [
    event.changes.admissions > 0 ? `${event.changes.admissions} ingresos` : '',
    event.changes.updates > 0 ? `${event.changes.updates} actualizaciones` : '',
    event.changes.moves > 0 ? `${event.changes.moves} movimientos` : '',
    event.changes.discharges > 0 ? `${event.changes.discharges} egresos` : '',
  ].filter(Boolean);
  return parts.join(' · ');
};

const sourceLabel = (event: RayenSyncEvent): string | null => {
  const source = event.source;
  if (!source) return null;
  const version = source.extensionVersion ? `Ext. v${source.extensionVersion}` : 'Extensión';
  const ficha = source.fichaMedico === 'ready' ? 'Ficha ✓' : 'Ficha —';
  const camas = source.gestionCamas === 'ready' ? 'Camas ✓' : 'Camas —';
  return `${version} · ${ficha} · ${camas}`;
};

export const RayenSyncHistoryModal: React.FC<RayenSyncHistoryModalProps> = ({
  isOpen,
  onClose,
  history,
  recovery,
  recoveryBusy,
  onRecoveryAction,
}) => (
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
        {history.map(event => {
          const status = statusPresentation(event);
          const outcome = presentRayenSyncOutcome(event);
          const coverage = presentRayenCoverage(
            event.coverage,
            event.status !== 'failed',
            event.status === 'applied'
          );
          const source = sourceLabel(event);
          return (
            <li
              key={event.id}
              className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
            >
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
                    <p className="mt-1 text-[11px] font-semibold text-amber-700">
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
              </div>
            </li>
          );
        })}
      </ol>
    )}
  </BaseModal>
);
