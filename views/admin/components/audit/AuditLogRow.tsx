import React from 'react';
import {
    ChevronDown, ChevronRight, FileText, GitBranch, LayoutGrid, MapPin, History
} from 'lucide-react';
import clsx from 'clsx';
import { AuditLogEntry, GroupedAuditLogEntry, AuditAction } from '@/types/audit';
import {
    formatTimestamp, actionIcons, actionColors, renderHumanDetails
} from './auditUIUtils';
import { DiffHighlight } from './DiffHighlight';
import { AUDIT_ACTION_LABELS } from '@/services/admin/auditService';

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
    compactView
}) => {
    const bedId = (log.details?.bedId as string) || '';
    const patientName = (log.details?.patientName as string) || '';
    const isGroup = (log as any as GroupedAuditLogEntry).isGroup;

    return (
        <>
            <tr
                className={clsx(
                    "group hover:bg-slate-50/80 transition-all cursor-pointer",
                    isExpanded ? "bg-indigo-50/20" : ""
                )}
                onClick={onToggle}
            >
                <td className="px-6 py-4">
                    {isExpanded
                        ? <ChevronDown size={18} className="text-indigo-500" />
                        : <ChevronRight size={18} className="text-slate-300 group-hover:text-slate-500" />
                    }
                </td>
                {/* Fecha/Hora */}
                <td className="px-4 py-4 whitespace-nowrap">
                    <div className="flex flex-col">
                        <span className="text-slate-900 font-bold">{formatTimestamp(log.timestamp).split(' ')[0]}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{formatTimestamp(log.timestamp).split(' ')[1]}</span>
                    </div>
                </td>
                {/* Operador */}
                <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">
                            {(log.userDisplayName || log.userId || 'U').charAt(0).toUpperCase()}
                        </div>
                        <div className="flex flex-col">
                            <span className="text-xs font-semibold text-slate-700 truncate max-w-[140px]" title={log.userId || 'Usuario desconocido'}>
                                {log.userDisplayName || (log.userId || 'anon@hhr.cl').split('@')[0]}
                            </span>
                            {log.ipAddress && (
                                <span className="text-[9px] text-slate-400 font-mono">
                                    IP: {log.ipAddress}
                                </span>
                            )}
                        </div>
                    </div>
                </td>
                {/* Acción (badge) - hidden in compact */}
                {!compactView && (
                    <td className="px-4 py-4">
                        <span className={clsx(
                            "inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-lg border shadow-sm whitespace-nowrap",
                            actionColors[log.action as AuditAction] || "bg-slate-50 text-slate-700 border-slate-100"
                        )}>
                            {actionIcons[log.action as AuditAction]}
                            {AUDIT_ACTION_LABELS[log.action as AuditAction]}
                        </span>
                    </td>
                )}
                {/* Resumen (HUMAN READABLE) */}
                <td className="px-4 py-4">
                    <span
                        className={clsx(
                            "text-xs text-slate-700 font-medium block truncate",
                            compactView ? "max-w-[300px]" : "max-w-[180px]"
                        )}
                        title={log.summary || renderHumanDetails(log)}
                    >
                        {log.summary || renderHumanDetails(log)}
                    </span>
                </td>
                {/* Paciente - hidden in compact */}
                {!compactView && (
                    <td className="px-4 py-4">
                        <span className="text-xs font-medium text-slate-600 truncate max-w-[150px]">
                            {log.entityType === 'user' ? '-' : (patientName || '-')}
                        </span>
                    </td>
                )}
                {/* Cama - hidden in compact */}
                {!compactView && (
                    <td className="px-4 py-4">
                        {log.entityType === 'user' || log.entityType === 'dailyRecord' ? (
                            <span className="text-[10px] font-bold text-slate-300 uppercase tracking-tighter">
                                {log.entityType === 'user' ? 'Sistema' : 'Registro'}
                            </span>
                        ) : bedId ? (
                            <div className="flex items-center gap-1.5 font-bold text-slate-700">
                                <MapPin size={12} className="text-slate-400" />
                                {bedId}
                            </div>
                        ) : (
                            <span className="text-slate-300">-</span>
                        )}
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
                                {(log as any as GroupedAuditLogEntry).childLogs.map((child: AuditLogEntry) => (
                                    <div key={child.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm flex flex-col gap-1 hover:border-amber-200 transition-colors">
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
                                            {child.summary || renderHumanDetails(child)}
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
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                                    <FileText size={16} className="text-indigo-500" />
                                    <div className="flex flex-col">
                                        <span>{renderHumanDetails(log)}</span>
                                        {log.authors && (
                                            <span className="text-[10px] font-medium text-slate-400 italic">
                                                Responsables: {log.authors}
                                            </span>
                                        )}
                                    </div>
                                </h4>
                            </div>

                            {/* Comparison / Diff View */}
                            {(log.action.includes('MODIFIED') || log.details?.changes) && (
                                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                    <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <History size={14} className="text-indigo-500" />
                                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Auditoría Diferencial</span>
                                        </div>
                                        <GitBranch size={12} className="text-slate-400" />
                                    </div>
                                    <div className="p-4 space-y-4">
                                        {(() => {
                                            const details = log.details as any;
                                            const changes = details.changes || {};
                                            const renderedFields = [];

                                            if (Object.keys(changes).length > 0) {
                                                for (const field in changes) {
                                                    renderedFields.push(
                                                        <div key={field} className="space-y-1.5">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">CAMPO:</span>
                                                                <span className="text-[11px] font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full uppercase">
                                                                    {field === 'note' ? 'Nota Clínica' : field === 'novedades' ? 'Novedades' : field}
                                                                </span>
                                                            </div>
                                                            <DiffHighlight
                                                                oldValue={changes[field].old}
                                                                newValue={changes[field].new}
                                                            />
                                                        </div>
                                                    );
                                                }
                                            }

                                            if (renderedFields.length === 0) {
                                                return (
                                                    <div className="py-8 text-center text-slate-400 italic text-[11px]">
                                                        No se detectaron cambios estructurales registrados en el log técnico.
                                                    </div>
                                                );
                                            }

                                            return renderedFields;
                                        })()}
                                    </div>
                                </div>
                            )}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
};
