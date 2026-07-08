import clsx from 'clsx';
import { useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  History,
  MapPin,
  MousePointerClick,
  RotateCcw,
  Trash2,
  UserRound,
} from 'lucide-react';
import type { UserHealthStatus } from '@/services/admin/healthService';
import type { SystemHealthIncidentRow } from './systemHealthIncidentUtils';

const formatDateTime = (timestamp: string): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
};

const severityClassName = {
  critical: 'border-red-200 bg-red-50 text-red-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  info: 'border-slate-200 bg-slate-50 text-slate-700',
};

export const SystemHealthIncidentDetailPanel = ({
  user,
  incidents,
  onDeleteSnapshot,
  onClearUserWindow,
  onResolveIncident,
  onReopenIncident,
  deleting,
  canManageSystemHealthOperations,
}: {
  user?: UserHealthStatus;
  incidents: SystemHealthIncidentRow[];
  onDeleteSnapshot: (user: UserHealthStatus) => void;
  onClearUserWindow: (user: UserHealthStatus, incidents: SystemHealthIncidentRow[]) => void;
  onResolveIncident: (incidentId: string, note?: string) => void;
  onReopenIncident: (incidentId: string) => void;
  deleting: boolean;
  canManageSystemHealthOperations: boolean;
}) => {
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});

  if (!user) {
    return (
      <aside className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
        Sin usuario seleccionado.
      </aside>
    );
  }

  return (
    <aside className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Detalle operativo
            </p>
            <h3 className="mt-1 truncate text-sm font-black text-slate-900">{user.displayName}</h3>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>
          {canManageSystemHealthOperations ? (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => onClearUserWindow(user, incidents)}
                disabled={deleting || incidents.length === 0}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Resolver incidentes visibles del usuario y borrar snapshot actual"
              >
                <CheckCircle2 size={12} /> Limpiar usuario
              </button>
              <button
                type="button"
                onClick={() => onDeleteSnapshot(user)}
                disabled={deleting}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-100 bg-red-50 text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                title="Borrar registro de salud"
                aria-label="Borrar registro de salud"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ) : (
            <span className="shrink-0 rounded-md border border-amber-100 bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">
              Requiere rol admin
            </span>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
          <span className="flex items-center gap-1">
            <Clock size={12} /> Ultima salud: {formatDateTime(user.lastSeen)}
          </span>
          <span className="flex items-center gap-1">
            <UserRound size={12} /> {user.isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      <div className="max-h-[720px] space-y-3 overflow-y-auto p-4">
        {incidents.length === 0 ? (
          <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            Sin incidentes recientes para el filtro actual.
          </div>
        ) : (
          incidents.map(incident => (
            <article
              key={incident.id}
              className={clsx(
                'rounded-lg border p-3 text-xs',
                severityClassName[incident.severity]
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-bold">
                      {incident.statusLabel}
                    </span>
                    <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-bold">
                      {incident.sourceLabel}
                    </span>
                    <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-bold">
                      {incident.categoryLabel}
                    </span>
                  </div>
                  <h4 className="mt-2 break-words text-sm font-black">{incident.title}</h4>
                </div>
                <span className="shrink-0 text-[10px] font-semibold">
                  {formatDateTime(incident.timestamp)}
                </span>
              </div>

              <div className="mt-3 space-y-1 text-[11px]">
                <p className="flex items-center gap-1">
                  <CalendarClock size={12} /> {incident.originLabel}
                </p>
                <p className="flex items-center gap-1">
                  <MousePointerClick size={12} /> {incident.actionLabel}
                </p>
                <p className="flex items-center gap-1">
                  <MapPin size={12} /> {incident.routeLabel}
                </p>
              </div>

              {incident.details.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1">
                  {incident.details.map(detail => (
                    <span
                      key={detail}
                      className="rounded border border-white/70 bg-white/70 px-1.5 py-0.5 text-[10px]"
                    >
                      {detail}
                    </span>
                  ))}
                </div>
              ) : null}

              {incident.resolutionHistory?.length ? (
                <div className="mt-3 rounded-md border border-white/70 bg-white/70 p-2">
                  <p className="mb-1 flex items-center gap-1 text-[10px] font-black uppercase tracking-wider">
                    <History size={11} /> Historial de resolucion
                  </p>
                  <div className="space-y-1">
                    {incident.resolutionHistory.slice(-3).map(entry => (
                      <p
                        key={`${entry.action}:${entry.at}:${entry.actorUid || 'unknown'}`}
                        className="text-[10px]"
                      >
                        <span className="font-bold">
                          {entry.action === 'resolved' ? 'Resuelto' : 'Reabierto'}
                        </span>{' '}
                        {formatDateTime(entry.at)} por{' '}
                        {entry.actorName || entry.actorEmail || 'usuario'}
                        {entry.note ? ` - ${entry.note}` : ''}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-3 flex justify-end">
                {!canManageSystemHealthOperations ? (
                  <span className="rounded-md border border-amber-100 bg-white/70 px-2 py-1 text-[10px] font-bold text-amber-700">
                    Requiere rol admin
                  </span>
                ) : incident.status === 'resolved' ? (
                  <button
                    type="button"
                    onClick={() => onReopenIncident(incident.resolutionKey)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <RotateCcw size={12} /> Reabrir
                  </button>
                ) : (
                  <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                    <input
                      type="text"
                      value={resolutionNotes[incident.resolutionKey] || ''}
                      onChange={event =>
                        setResolutionNotes(current => ({
                          ...current,
                          [incident.resolutionKey]: event.target.value,
                        }))
                      }
                      placeholder="Nota de resolucion..."
                      className="min-w-0 flex-1 rounded-md border border-white/80 bg-white/80 px-2 py-1 text-[11px] text-slate-700 outline-none focus:border-medical-400 focus:ring-2 focus:ring-medical-400/20 sm:max-w-[210px]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        onResolveIncident(
                          incident.resolutionKey,
                          resolutionNotes[incident.resolutionKey]?.trim()
                        )
                      }
                      className="inline-flex items-center justify-center gap-1 rounded-md border border-emerald-100 bg-white px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-50"
                    >
                      <CheckCircle2 size={12} /> Marcar resuelto
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </aside>
  );
};
