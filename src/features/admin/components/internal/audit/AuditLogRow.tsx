import React from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  LayoutGrid,
  MapPin,
  History,
  MonitorCheck,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import clsx from 'clsx';
import { AuditAction } from '@/types/auditActionTypes';
import { AuditLogEntry, isGroupedAuditLogEntry } from '@/types/auditLogTypes';
import { formatTimestamp, actionColors } from './auditUIUtils';
import { buildClinicalAuditPresentation } from '@/services/admin/clinicalAuditPresentation';

interface AuditLogRowProps {
  log: AuditLogEntry;
  isExpanded: boolean;
  onToggle: () => void;
  compactView?: boolean;
}

export const AuditLogRow: React.FC<AuditLogRowProps> = ({
  log,
  isExpanded,
  onToggle,
  compactView,
}) => {
  const isGroup = isGroupedAuditLogEntry(log);
  const presentation = buildClinicalAuditPresentation(log);
  const technicalDetailText = JSON.stringify(
    {
      action: presentation.technical.action,
      entityType: presentation.technical.entityType,
      entityId: presentation.technical.entityId,
      details: presentation.technical.details,
    },
    null,
    2
  );

  return (
    <>
      <tr
        className={clsx(
          'group hover:bg-slate-50/80 transition-all cursor-pointer',
          isExpanded ? 'bg-indigo-50/20' : ''
        )}
        onClick={onToggle}
      >
        <td className="px-6 py-4">
          {isExpanded ? (
            <ChevronDown size={18} className="text-indigo-500" />
          ) : (
            <ChevronRight size={18} className="text-slate-300 group-hover:text-slate-500" />
          )}
        </td>
        {/* Fecha/Hora */}
        <td className="px-4 py-4 whitespace-nowrap">
          <div className="flex flex-col">
            <span className="text-slate-900 font-bold">
              {formatTimestamp(log.timestamp).split(' ')[0]}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {formatTimestamp(log.timestamp).split(' ')[1]}
            </span>
          </div>
        </td>
        {/* Operador */}
        <td className="px-4 py-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">
              {(log.userDisplayName || log.userId || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col">
              <span
                className="text-xs font-semibold text-slate-700 truncate max-w-[140px]"
                title={presentation.actorSecondary || presentation.actorLabel}
              >
                {presentation.actorLabel}
              </span>
              {presentation.actorSecondary && (
                <span className="text-[9px] text-slate-400 font-mono truncate max-w-[160px]">
                  {presentation.actorSecondary}
                </span>
              )}
            </div>
          </div>
        </td>
        {/* Evento clinico - hidden in compact */}
        {!compactView && (
          <td className="px-4 py-4">
            <span
              className={clsx(
                'inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg border shadow-sm whitespace-nowrap',
                actionColors[log.action as AuditAction] ||
                  'bg-slate-50 text-slate-700 border-slate-100'
              )}
            >
              <ShieldCheck size={14} />
              {presentation.title}
            </span>
          </td>
        )}
        {/* Resumen clinico */}
        <td className="px-4 py-4">
          <div
            className={clsx(
              'flex flex-col gap-0.5',
              compactView ? 'max-w-[360px]' : 'max-w-[260px]'
            )}
            title={presentation.narrative}
          >
            {compactView && (
              <span className="text-xs font-bold text-slate-800 truncate">
                {presentation.title}
              </span>
            )}
            <span className="text-xs text-slate-700 font-medium block truncate">
              {presentation.narrative}
            </span>
          </div>
        </td>
        {/* Paciente - hidden in compact */}
        {!compactView && (
          <td className="px-4 py-4">
            <span className="text-xs font-medium text-slate-600 truncate max-w-[150px]">
              {presentation.affectedSubject}
            </span>
          </td>
        )}
        {/* Origen - hidden in compact */}
        {!compactView && (
          <td className="px-4 py-4">
            <div className="flex items-center gap-1.5 font-bold text-slate-700">
              <MonitorCheck size={12} className="text-slate-400" />
              <span className="text-[10px]">{presentation.originLabel}</span>
            </div>
          </td>
        )}
      </tr>

      {/* Grouped Details */}
      {isGroup && isExpanded && (
        <tr className="bg-amber-50/10">
          <td colSpan={compactView ? 4 : 7} className="px-12 py-4 border-l-4 border-amber-500/30">
            <div className="space-y-3">
              <h5 className="text-[10px] font-bold text-amber-600 uppercase tracking-widest flex items-center gap-1.5">
                <LayoutGrid size={12} />
                Detalle de acciones agrupadas
              </h5>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {isGroup &&
                  log.childLogs.map((child: AuditLogEntry) => (
                    <div
                      key={child.id}
                      className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex flex-col gap-1 hover:border-amber-200 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-400 font-mono">
                          {formatTimestamp(child.timestamp).split(' ')[1]}
                        </span>
                        {(child.details?.bedId || child.entityType === 'patient') && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold">
                            Cama {String(child.details?.bedId || child.entityId)}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                        {buildClinicalAuditPresentation(child).narrative}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          </td>
        </tr>
      )}

      {/* EXPANSIBLE DETAILS (Individual or first of group) */}
      {!isGroup && isExpanded && (
        <tr className="bg-slate-50/50">
          <td colSpan={compactView ? 4 : 7} className="px-12 py-6 border-l-4 border-indigo-500/30">
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm lg:col-span-3">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-2">
                    <FileText size={14} className="text-indigo-500" />
                    Resumen clínico
                  </h4>
                  <p className="text-sm font-bold text-slate-800">{presentation.title}</p>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    {presentation.narrative}
                  </p>
                  {log.authors && (
                    <p className="text-[10px] font-medium text-slate-400 italic mt-2">
                      Responsables documentados: {log.authors}
                    </p>
                  )}
                </section>

                <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-2">
                    <UserRound size={14} className="text-indigo-500" />
                    Responsable
                  </h4>
                  <p className="text-xs font-bold text-slate-800">{presentation.actorLabel}</p>
                  {presentation.actorSecondary && (
                    <p className="text-[10px] text-slate-500 mt-1 break-all">
                      {presentation.actorSecondary}
                    </p>
                  )}
                </section>

                <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-2">
                    <MonitorCheck size={14} className="text-indigo-500" />
                    Origen de acceso
                  </h4>
                  <p className="text-xs font-bold text-slate-800">{presentation.originLabel}</p>
                  <p className="text-[10px] text-slate-500 mt-1">{presentation.timestampLabel}</p>
                </section>

                <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                  <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-2">
                    <MapPin size={14} className="text-indigo-500" />
                    Afectado
                  </h4>
                  <p className="text-xs font-bold text-slate-800">{presentation.affectedSubject}</p>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Area: {presentation.clinicalArea} · Impacto: {presentation.impact}
                  </p>
                </section>
              </div>

              {presentation.importantChanges.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <History size={14} className="text-indigo-500" />
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                        Cambios relevantes
                      </span>
                    </div>
                  </div>
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {presentation.importantChanges.map(change => (
                      <div
                        key={change.fieldLabel}
                        className="rounded-lg border border-slate-100 bg-slate-50/60 p-3"
                      >
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                          {change.fieldLabel}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-1">
                          Antes:{' '}
                          <span className="text-rose-700">{String(change.oldValue ?? '-')}</span>
                        </p>
                        <p className="text-[11px] text-slate-600">
                          Despues:{' '}
                          <span className="font-bold text-emerald-700">
                            {String(change.newValue ?? '-')}
                          </span>
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <details className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <summary className="cursor-pointer bg-slate-50 px-4 py-2 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  Detalle técnico avanzado
                </summary>
                <pre className="p-4 text-[10px] text-slate-500 overflow-auto">
                  {technicalDetailText}
                </pre>
              </details>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};
