import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Clock3, Download, ListChecks, MapPin } from 'lucide-react';
import type { SystemHealthIncidentQueueRow } from './systemHealthIncidentUtils';

const formatIncidentTime = (timestamp: string): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Sin fecha';
  return new Intl.DateTimeFormat('es-CL', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
};

const severityClassName = {
  critical: 'bg-red-50 text-red-700 border-red-100',
  warning: 'bg-amber-50 text-amber-700 border-amber-100',
  info: 'bg-slate-50 text-slate-700 border-slate-200',
};

export const SystemHealthIncidentQueue = ({
  incidents,
  selectedResolutionKey,
  onSelectIncident,
  onExportCsv,
  onResolveVisibleIncidents,
  canManageSystemHealthOperations,
}: {
  incidents: SystemHealthIncidentQueueRow[];
  selectedResolutionKey?: string | null;
  onSelectIncident: (incident: SystemHealthIncidentQueueRow) => void;
  onExportCsv: () => void;
  onResolveVisibleIncidents: () => void;
  canManageSystemHealthOperations: boolean;
}) => (
  <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
      <div className="flex items-center gap-2">
        <ListChecks size={16} className="text-slate-500" />
        <h3 className="text-sm font-black text-slate-900">Incidencias activas</h3>
      </div>
      <div className="flex items-center gap-2">
        {canManageSystemHealthOperations ? (
          <button
            type="button"
            onClick={onResolveVisibleIncidents}
            disabled={!incidents.some(incident => incident.status !== 'resolved')}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-100 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CheckCircle2 size={13} /> Marcar visibles resueltos
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-100 bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-700">
            Requiere rol admin
          </span>
        )}
        <button
          type="button"
          onClick={onExportCsv}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
        >
          <Download size={13} /> Exportar CSV
        </button>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">
          {incidents.length} visibles
        </span>
      </div>
    </div>

    {incidents.length === 0 ? (
      <div className="flex items-center gap-2 px-4 py-5 text-xs text-slate-500">
        <AlertTriangle size={14} className="text-slate-300" />
        Sin incidentes para los filtros actuales.
      </div>
    ) : (
      <div>
        <div className="grid grid-cols-[128px_180px_86px_minmax(0,1fr)] gap-3 border-b border-slate-100 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          <span>Fecha</span>
          <span>Usuario</span>
          <span>Severidad</span>
          <span>Incidencia accionable</span>
        </div>

        <div className="max-h-[560px] overflow-y-auto">
          {incidents.map(incident => (
            <button
              key={incident.resolutionKey}
              type="button"
              onClick={() => onSelectIncident(incident)}
              className={clsx(
                'grid w-full grid-cols-[128px_180px_86px_minmax(0,1fr)] gap-3 border-b border-slate-100 px-4 py-3 text-left text-xs transition-colors hover:bg-slate-50 focus:bg-medical-50 focus:outline-none',
                selectedResolutionKey === incident.resolutionKey ? 'bg-medical-50/70' : 'bg-white',
                incident.status === 'resolved' && 'opacity-65'
              )}
            >
              <span className="flex items-start gap-1 text-slate-600">
                <Clock3 size={12} className="mt-0.5 shrink-0" />{' '}
                {formatIncidentTime(incident.timestamp)}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-bold text-slate-800">
                  {incident.userLabel}
                </span>
                <span className="block truncate text-[10px] text-slate-500">
                  {incident.userEmail}
                </span>
              </span>
              <span
                className={clsx(
                  'h-fit w-fit rounded border px-1.5 py-0.5 text-[10px] font-black uppercase',
                  severityClassName[incident.severity]
                )}
              >
                {incident.severity}
              </span>
              <span className="min-w-0 space-y-1">
                <span className="block font-bold text-slate-800">{incident.title}</span>
                <span className="flex min-w-0 items-center gap-1 text-[11px] text-slate-600">
                  <MapPin size={12} className="shrink-0 text-slate-400" />
                  <span className="truncate">{incident.originLabel}</span>
                </span>
                <span className="block text-[11px] text-slate-500">
                  {incident.actionLabel} · {incident.routeLabel} · {incident.statusLabel}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    )}
  </section>
);
