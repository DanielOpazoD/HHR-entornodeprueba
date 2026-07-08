import React, { useMemo, useState } from 'react';
import {
  Activity,
  CalendarClock,
  Clock,
  FileText,
  Fingerprint,
  MonitorCheck,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { AuditLogEntry } from '@/types/auditLogTypes';
import {
  buildClinicalAuditTimelineGroups,
  type ClinicalAuditTimelineEvent,
} from '@/services/admin/clinicalAuditTimeline';

interface AuditTimelineProps {
  logs: AuditLogEntry[];
}

const impactTone = (impact: string): string => {
  if (impact === 'eliminacion') return 'bg-rose-50 text-rose-700 border-rose-100';
  if (impact === 'modificacion') return 'bg-amber-50 text-amber-700 border-amber-100';
  if (impact === 'visualizacion') return 'bg-sky-50 text-sky-700 border-sky-100';
  if (impact === 'sistema') return 'bg-slate-100 text-slate-700 border-slate-200';
  return 'bg-emerald-50 text-emerald-700 border-emerald-100';
};

const timelineDotTone = (event: ClinicalAuditTimelineEvent): string => {
  if (event.impact === 'eliminacion') return 'bg-rose-500 ring-rose-100';
  if (event.impact === 'modificacion') return 'bg-amber-500 ring-amber-100';
  if (event.impact === 'visualizacion') return 'bg-sky-500 ring-sky-100';
  if (event.impact === 'sistema') return 'bg-slate-500 ring-slate-100';
  return 'bg-emerald-500 ring-emerald-100';
};

export const AuditTimeline: React.FC<AuditTimelineProps> = ({ logs }) => {
  const timelineGroups = buildClinicalAuditTimelineGroups(logs);
  const [selectedSubjectKey, setSelectedSubjectKey] = useState<string | null>(null);
  const selectedGroup = useMemo(
    () => timelineGroups.find(group => group.subjectKey === selectedSubjectKey),
    [selectedSubjectKey, timelineGroups]
  );
  const visibleGroups = selectedGroup ? [selectedGroup] : timelineGroups.slice(0, 8);
  const totalEvents = timelineGroups.reduce((count, group) => count + group.eventCount, 0);
  const eventsWithOrigin = timelineGroups
    .flatMap(group => group.events)
    .filter(event => event.origin !== 'IP no disponible').length;
  const originCoverage =
    totalEvents > 0 ? `${Math.round((eventsWithOrigin / totalEvents) * 100)}% con IP` : '0% con IP';

  return (
    <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-6 py-5 border-b border-slate-200 bg-slate-50/80">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-white border border-slate-200 flex items-center justify-center shadow-sm">
              <FileText className="text-slate-700" size={20} />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Expediente clínico/legal</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                Línea de tiempo auditada por episodio, paciente o registro, con responsable,
                origen/IP y cambios relevantes.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 min-w-full lg:min-w-[520px]">
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] font-semibold uppercase text-slate-400">Eventos trazados</p>
              <p className="text-lg font-bold text-slate-900">{totalEvents}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] font-semibold uppercase text-slate-400">
                Sujetos/episodios
              </p>
              <p className="text-lg font-bold text-slate-900">{timelineGroups.length}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <p className="text-[10px] font-semibold uppercase text-slate-400">Cobertura origen</p>
              <p className="text-lg font-bold text-slate-900">{originCoverage}</p>
            </div>
          </div>
        </div>
      </div>

      {timelineGroups.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
          <Clock className="text-slate-300" size={26} />
          <p className="text-sm font-medium text-slate-500">
            Sin eventos de auditoría para construir línea de tiempo.
          </p>
        </div>
      )}

      {timelineGroups.length > 1 && (
        <div className="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-0 border-b border-slate-200">
          <aside className="border-b xl:border-b-0 xl:border-r border-slate-200 bg-slate-50/60 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-[10px] font-bold uppercase text-slate-400">
                  Paquetes clínico-legales
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSubjectKey(null)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100"
              >
                Ver todos los paquetes
              </button>
            </div>

            <div className="space-y-2">
              {timelineGroups.slice(0, 12).map(group => (
                <button
                  key={group.subjectKey}
                  type="button"
                  onClick={() => setSelectedSubjectKey(group.subjectKey)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    selectedSubjectKey === group.subjectKey
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-900'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="block truncate text-xs font-bold">{group.subjectLabel}</span>
                  <span className="mt-1 block truncate text-[11px] text-slate-500">
                    {group.eventCount} evento{group.eventCount === 1 ? '' : 's'} ·{' '}
                    {group.latestTimestamp}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <div className="p-5 bg-white">
            <p className="text-[10px] font-bold uppercase text-slate-400">Paquete seleccionado</p>
            {selectedGroup ? (
              <div className="mt-2 grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase text-slate-400">
                    Detalle del paquete
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-900">
                    {selectedGroup.subjectLabel}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{selectedGroup.subjectDetail}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase text-slate-400">
                    Cadena de custodia
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-900">
                    {selectedGroup.eventCount} evento{selectedGroup.eventCount === 1 ? '' : 's'} ·{' '}
                    {selectedGroup.originCoverageLabel}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Áreas: {selectedGroup.clinicalAreas.join(', ') || 'sin área'}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                  <p className="text-[10px] font-semibold uppercase text-slate-400">
                    Exportable legal
                  </p>
                  <p className="mt-1 text-sm font-bold text-slate-900">
                    {selectedGroup.packageKindLabel}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{selectedGroup.packageSummary}</p>
                </div>
              </div>
            ) : (
              <p className="mt-1 text-sm font-medium text-slate-600">
                Vista general de todos los paquetes visibles.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="divide-y divide-slate-200">
        {visibleGroups.map(group => (
          <section key={group.subjectKey} className="px-6 py-5">
            <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4 mb-5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  {group.episodeId && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-indigo-100 bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700">
                      <Fingerprint size={12} />
                      Episodio clínico
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 rounded-md border border-emerald-100 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
                    <ShieldCheck size={12} />
                    {group.packageKindLabel}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-500">
                    <CalendarClock size={12} />
                    {group.latestTimestamp}
                  </span>
                </div>
                <h4 className="text-sm font-bold text-slate-900">{group.subjectLabel}</h4>
                {group.episodeId && (
                  <p className="mt-1 font-mono text-[11px] text-indigo-700 break-all">
                    {group.episodeId}
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-500">{group.subjectDetail}</p>
                <p className="mt-2 text-xs font-medium text-slate-700">{group.packageSummary}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-right sm:min-w-[260px]">
                <div className="rounded-lg bg-slate-50 px-3 py-2 border border-slate-100">
                  <p className="text-[10px] uppercase font-semibold text-slate-400">Eventos</p>
                  <p className="text-sm font-bold text-slate-800">{group.eventCount}</p>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2 border border-slate-100">
                  <p className="text-[10px] uppercase font-semibold text-slate-400">Origen</p>
                  <p className="text-sm font-bold text-slate-800">{group.originCoverageLabel}</p>
                </div>
              </div>
            </div>

            <div className="relative pl-7">
              <div className="absolute left-[10px] top-1 bottom-1 w-px bg-slate-200" />
              {group.events.slice(0, 12).map(event => (
                <article key={event.sourceLogId} className="relative pb-5 last:pb-0">
                  <div
                    className={`absolute -left-[22px] top-1.5 w-3 h-3 rounded-full ring-4 ${timelineDotTone(event)}`}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                            <ShieldCheck size={14} className="text-slate-500" />
                            {event.title}
                          </p>
                          <span
                            className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${impactTone(event.impact)}`}
                          >
                            {event.impact}
                          </span>
                          <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium uppercase text-slate-500">
                            {event.clinicalArea}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                          {event.narrative}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 whitespace-nowrap">
                        <Clock size={12} />
                        {event.timestamp}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-1 lg:grid-cols-[1fr_1fr_1fr] gap-2 text-[11px] text-slate-500">
                      <span className="inline-flex items-center gap-1 min-w-0">
                        <UserRound size={12} className="shrink-0" />
                        <span className="truncate">{event.responsible}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 min-w-0">
                        <MonitorCheck size={12} className="shrink-0" />
                        <span className="truncate">{event.origin}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 min-w-0">
                        <Activity size={12} className="shrink-0" />
                        <span className="truncate">Afectado: {event.affected}</span>
                      </span>
                    </div>

                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase text-slate-400">
                        Cambios relevantes
                      </p>
                      <p className="mt-1 text-xs text-slate-700">{event.relevantChanges}</p>
                    </div>
                  </div>
                </article>
              ))}
              {group.events.length > 12 && (
                <p className="text-[11px] text-slate-400 pl-4">
                  +{group.events.length - 12} eventos más...
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};
