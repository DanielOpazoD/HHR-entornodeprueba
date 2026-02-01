import React, { useState, useMemo } from 'react';
import { Search, User, History, FileText, ChevronRight, Clock } from 'lucide-react';
import clsx from 'clsx';
import { AuditLogEntry } from '@/types/audit';
import { useClinicalData } from '@/hooks/admin/useClinicalData';
import { TraceabilityTimeline } from './TraceabilityTimeline';
import { TraceabilitySummary } from './TraceabilitySummary';
import { parseAuditTimestamp } from './auditUIUtils';

interface PatientTraceabilityProps {
    logs: AuditLogEntry[];
    searchRut: string;
    onSelectPatient: (rut: string) => void;
}

export const PatientTraceability: React.FC<PatientTraceabilityProps> = ({ logs, searchRut, onSelectPatient }) => {
    const [traceTab, setTraceTab] = useState<'TIMELINE' | 'SUMMARY'>('TIMELINE');

    // List of patients hospitalized in the last 30 days
    const recentPatients = useMemo(() => {
        const patientMap = new Map<string, { rut: string, name: string, lastEvent: string }>();

        logs.forEach(log => {
            const rut = (log.patientIdentifier || log.details?.rut || '').replace(/[^0-9kK]/g, '').toLowerCase();
            const name = log.details?.patientName;

            if (rut && name) {
                const existing = patientMap.get(rut);
                if (!existing || parseAuditTimestamp(log.timestamp) > parseAuditTimestamp(existing.lastEvent)) {
                    patientMap.set(rut, { rut, name, lastEvent: log.timestamp });
                }
            }
        });

        return Array.from(patientMap.values())
            .sort((a, b) => parseAuditTimestamp(b.lastEvent).getTime() - parseAuditTimestamp(a.lastEvent).getTime())
            .slice(0, 10);
    }, [logs]);

    // Sort by timestamp asc for chronology
    const chronologicalLogs = useMemo(() => {
        if (!searchRut) return [];
        return [...logs].sort((a, b) =>
            parseAuditTimestamp(a.timestamp).getTime() - parseAuditTimestamp(b.timestamp).getTime()
        );
    }, [logs, searchRut]);

    // Basic aggregation
    const admissions = useMemo(() => chronologicalLogs.filter(l => l.action === 'PATIENT_ADMITTED'), [chronologicalLogs]);
    const discharges = useMemo(() => chronologicalLogs.filter(l => l.action === 'PATIENT_DISCHARGED'), [chronologicalLogs]);
    const lastNote = useMemo(() => chronologicalLogs.filter(l => l.details?.pathology).pop(), [chronologicalLogs]);
    const lastBed = useMemo(() => chronologicalLogs.filter(l => l.details?.bedId).pop(), [chronologicalLogs]);

    const clinicalData = useClinicalData(searchRut, chronologicalLogs, admissions, discharges);

    if (!searchRut) {
        return (
            <div className="bg-white rounded-2xl p-12 text-center border-2 border-dashed border-slate-200">
                <div className="w-16 h-16 bg-cyan-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <History size={32} className="text-cyan-500" />
                </div>
                <h3 className="text-lg font-bold text-slate-700 mb-2">Trazabilidad Clínica</h3>
                <p className="text-slate-500 max-w-md mx-auto mb-8">
                    Ingrese un RUT en el buscador superior o seleccione un paciente reciente de la lista para reconstruir su historia clínica.
                </p>

                {recentPatients.length > 0 && (
                    <div className="max-w-2xl mx-auto">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 text-left">Pacientes Recientes</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {recentPatients.map(p => (
                                <button
                                    key={p.rut}
                                    onClick={() => onSelectPatient(p.rut)}
                                    className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 hover:border-cyan-200 hover:bg-cyan-50 transition-all text-left group"
                                >
                                    <div className="w-8 h-8 rounded-lg bg-slate-50 group-hover:bg-white flex items-center justify-center text-slate-400 group-hover:text-cyan-500 transition-colors">
                                        <User size={16} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-bold text-slate-700 truncate">{p.name}</p>
                                        <p className="text-[10px] text-slate-400 font-mono">{p.rut}</p>
                                    </div>
                                    <ChevronRight size={14} className="text-slate-300 group-hover:text-cyan-400" />
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    if (logs.length === 0) {
        return (
            <div className="bg-white rounded-2xl p-12 text-center border-2 border-dashed border-slate-200">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Search size={32} className="text-slate-300" />
                </div>
                <h3 className="text-lg font-bold text-slate-700 mb-2">Sin registros</h3>
                <p className="text-slate-500">No se encontraron eventos asociados al RUT {searchRut}.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Patient Header Summary */}
            <div className="bg-gradient-to-r from-cyan-600 to-blue-700 rounded-2xl p-6 text-white shadow-lg border border-cyan-500/20">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center border border-white/30">
                            <User size={32} />
                        </div>
                        <div>
                            <h2 className="text-2xl font-black tracking-tight">{lastNote?.details?.patientName || 'Paciente'}</h2>
                            <p className="text-cyan-100 font-mono text-lg">{searchRut}</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 md:flex md:items-center md:gap-8">
                        <div className="bg-white/10 backdrop-blur-sm px-4 py-2 rounded-xl border border-white/10">
                            <p className="text-[10px] font-bold text-cyan-200 uppercase tracking-widest text-center">Estado Actual</p>
                            <p className="text-lg font-black text-center">{discharges.length >= admissions.length ? '🏠 ALTA' : '🏥 HOSPITALIZADO'}</p>
                        </div>
                        <div className="bg-white/10 backdrop-blur-sm px-4 py-2 rounded-xl border border-white/10">
                            <p className="text-[10px] font-bold text-cyan-200 uppercase tracking-widest text-center">Ingresos</p>
                            <p className="text-lg font-black text-center">{admissions.length}</p>
                        </div>
                        <div className="bg-white/10 backdrop-blur-sm px-4 py-2 rounded-xl border border-white/10">
                            <p className="text-[10px] font-bold text-cyan-200 uppercase tracking-widest text-center">Última Cama</p>
                            <p className="text-lg font-black text-center">{lastBed?.details?.bedId || '-'}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-1 p-1 bg-slate-100/50 rounded-xl w-fit border border-slate-200/50">
                <button
                    onClick={() => setTraceTab('TIMELINE')}
                    className={clsx(
                        "flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                        traceTab === 'TIMELINE' ? "bg-white text-cyan-600 shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-white/50"
                    )}
                >
                    <History size={14} />
                    Línea de Tiempo
                </button>
                <button
                    onClick={() => setTraceTab('SUMMARY')}
                    className={clsx(
                        "flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-all",
                        traceTab === 'SUMMARY' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700 hover:bg-white/50"
                    )}
                >
                    <FileText size={14} />
                    Resumen Clínico
                </button>
            </div>

            {traceTab === 'TIMELINE' ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    <div className="lg:col-span-8 space-y-4">
                        <TraceabilityTimeline chronologicalLogs={chronologicalLogs} />
                    </div>

                    <div className="lg:col-span-4 space-y-6">
                        {/* Diagnosis Evolution Mini-View */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
                                <History size={18} className="text-amber-500" />
                                <h3 className="font-bold text-slate-700">Diagnóstico</h3>
                            </div>
                            <div className="p-5 space-y-4">
                                {clinicalData.diagnosisHistory.slice(0, 5).map((dx, idx) => (
                                    <div key={idx} className="relative pl-4 border-l-2 border-amber-100 pb-2 last:pb-0">
                                        <p className="text-[10px] text-slate-400 font-bold">{dx.date.toLocaleDateString()}</p>
                                        <p className="text-xs text-slate-700 mt-1">{dx.pathology}</p>
                                    </div>
                                ))}
                                {clinicalData.diagnosisHistory.length === 0 && (
                                    <p className="text-xs text-slate-400 italic">No hay registros de evolución diagnóstica.</p>
                                )}
                            </div>
                        </div>

                        {/* Stay Stats Mini-View */}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
                                <Clock size={18} className="text-indigo-500" />
                                <h3 className="font-bold text-slate-700">Estadía Total</h3>
                            </div>
                            <div className="p-5">
                                {admissions.map((adm, idx) => {
                                    const nextDischarge = discharges.find(d => parseAuditTimestamp(d.timestamp) > parseAuditTimestamp(adm.timestamp));
                                    const end = nextDischarge ? parseAuditTimestamp(nextDischarge.timestamp) : new Date();
                                    const days = Math.ceil((end.getTime() - parseAuditTimestamp(adm.timestamp).getTime()) / (1000 * 60 * 60 * 24));

                                    return (
                                        <div key={adm.id} className="mb-4 last:mb-0 bg-slate-50 p-3 rounded-xl border border-slate-100">
                                            <div className="flex justify-between items-center mb-1">
                                                <span className="text-[10px] font-bold text-slate-400">PERIODO {idx + 1}</span>
                                            </div>
                                            <p className="text-[11px] font-bold text-slate-700">
                                                {new Date(adm.timestamp).toLocaleDateString()} - {nextDischarge ? new Date(nextDischarge.timestamp).toLocaleDateString() : 'Actualidad'}
                                            </p>
                                            <div className="mt-2 flex items-end gap-1">
                                                <span className="text-2xl font-black text-indigo-600 leading-none">{days}</span>
                                                <span className="text-[10px] font-bold text-indigo-400 mb-0.5">DÍAS</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <TraceabilitySummary clinicalData={clinicalData} />
            )}
        </div>
    );
};
