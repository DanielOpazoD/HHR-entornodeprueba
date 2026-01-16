import React from 'react';
import { History, Activity, Clock } from 'lucide-react';
import clsx from 'clsx';
import { AuditLogEntry } from '@/types/audit';
import { AUDIT_ACTION_LABELS } from '@/services/admin/auditService';

interface TraceabilityTimelineProps {
    chronologicalLogs: AuditLogEntry[];
}

export const TraceabilityTimeline: React.FC<TraceabilityTimelineProps> = ({ chronologicalLogs }) => {
    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <h3 className="font-bold text-slate-700 flex items-center gap-2">
                    <History size={18} className="text-cyan-500" />
                    Historial Cronológico
                </h3>
                <span className="text-xs text-slate-400 font-medium">{chronologicalLogs.length} eventos registrados</span>
            </div>
            <div className="p-6 relative">
                {/* Vertical Line */}
                <div className="absolute left-9 top-6 bottom-6 w-0.5 bg-slate-100" />

                <div className="space-y-8">
                    {chronologicalLogs.map((log) => {
                        const date = new Date(log.timestamp);
                        const isAdmission = log.action === 'PATIENT_ADMITTED';
                        const isDischarge = log.action === 'PATIENT_DISCHARGED';
                        const isTransfer = log.action === 'PATIENT_TRANSFERRED';
                        const isDevice = log.details?.changes?.deviceDetails;

                        return (
                            <div key={log.id} className="relative flex gap-6 group">
                                {/* Date/Time Bubble */}
                                <div className="w-16 pt-1 text-right">
                                    <p className="text-xs font-black text-slate-900 leading-none">{date.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })}</p>
                                    <p className="text-[10px] text-slate-400 font-medium mt-1">{date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</p>
                                </div>

                                {/* Timeline Node */}
                                <div className={clsx(
                                    "relative z-10 w-6 h-6 rounded-full border-4 border-white shadow-sm mt-1 flex-shrink-0",
                                    isAdmission ? "bg-emerald-500" :
                                        isDischarge ? "bg-rose-500" :
                                            isTransfer ? "bg-amber-500" :
                                                isDevice ? "bg-cyan-500" :
                                                    "bg-slate-300"
                                )} />

                                {/* Event Card */}
                                <div className={clsx(
                                    "flex-1 p-4 rounded-xl border transition-all group-hover:shadow-md",
                                    isAdmission ? "bg-emerald-50/50 border-emerald-100" :
                                        isDischarge ? "bg-rose-50/50 border-rose-100" :
                                            isTransfer ? "bg-amber-50/50 border-amber-100" :
                                                "bg-white border-slate-100"
                                )}>
                                    <div className="flex items-start justify-between mb-2">
                                        <h4 className="text-sm font-bold text-slate-800">
                                            {AUDIT_ACTION_LABELS[log.action]}
                                        </h4>
                                        <span className="text-[10px] text-slate-400 font-mono">#{log.id.slice(-6)}</span>
                                    </div>
                                    <p className="text-xs text-slate-600 leading-relaxed font-semibold">
                                        {log.summary}
                                    </p>

                                    {/* Specialized Detail Display for Traceability */}
                                    {log.details?.changes && (
                                        <div className="mt-3 bg-white/60 rounded-lg p-2.5 border border-slate-100/50 space-y-2">
                                            {Object.entries(log.details.changes).map(([field, delta]) => {
                                                if (field === 'deviceDetails') {
                                                    const values = delta as any as Record<string, { old: any; new: any }>;
                                                    return Object.entries(values).map(([dev, values]) => (
                                                        <div key={dev} className="flex items-center gap-2 text-[10px]">
                                                            <span className="bg-cyan-100 text-cyan-700 px-1.5 py-0.5 rounded font-bold">{dev}</span>
                                                            <span className="text-slate-400">➔</span>
                                                            <span className="text-slate-600">{values.new?.installationDate ? `Instalado ${values.new.installationDate}` : 'Retirado'}</span>
                                                        </div>
                                                    ));
                                                }
                                                return (
                                                    <div key={field} className="flex items-center gap-2 text-[10px]">
                                                        <span className="text-slate-400 italic capitalize">{field}:</span>
                                                        <span className="text-slate-500 line-through">{(delta.old as string) || 'n/a'}</span>
                                                        <span className="text-slate-400">➔</span>
                                                        <span className="text-slate-700 font-bold">{(delta.new as string) || 'n/a'}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    <div className="mt-2 flex items-center gap-2">
                                        <div className="w-4 h-4 rounded-full bg-slate-100 flex items-center justify-center text-[8px] font-bold text-slate-500">
                                            {log.userId.charAt(0).toUpperCase()}
                                        </div>
                                        <span className="text-[9px] text-slate-400">Acción by {log.userId.split('@')[0]}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
