import React from 'react';
import { MapPin, Clock, Zap, BedDouble, Stethoscope, Activity } from 'lucide-react';
import clsx from 'clsx';
import { ClinicalData } from '@/hooks/admin/useClinicalData';
import { parseAuditTimestamp } from './auditUIUtils';

interface TraceabilitySummaryProps {
    clinicalData: ClinicalData;
}

export const TraceabilitySummary: React.FC<TraceabilitySummaryProps> = ({ clinicalData }) => {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-right-4 duration-500">
            {/* Left Column: Stats & Bed History */}
            <div className="lg:col-span-2 space-y-6">
                {/* Summary Header Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-cyan-50 flex items-center justify-center">
                            <Clock className="text-cyan-600" size={24} />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Estadía Hospitalaria</p>
                            <p className="text-2xl font-black text-slate-900">
                                {(() => {
                                    const start = clinicalData.firstAdmission ? parseAuditTimestamp(clinicalData.firstAdmission) : null;
                                    const end = clinicalData.lastDischarge ? parseAuditTimestamp(clinicalData.lastDischarge) : new Date();
                                    if (!start) return '-';
                                    return `${Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))} días`;
                                })()}
                            </p>
                        </div>
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center">
                            <Zap className="text-amber-600" size={24} />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Estadía UPC (Ticket)</p>
                            <p className="text-2xl font-black text-slate-900">{clinicalData.totalUpcDays} días</p>
                        </div>
                    </div>
                </div>

                {/* Bed Movement History */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50/30">
                        <BedDouble size={18} className="text-indigo-500" />
                        <h3 className="font-bold text-slate-700">Historial de Camas y Movimientos</h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50/50 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                <tr>
                                    <th className="px-5 py-3 text-left">Cama</th>
                                    <th className="px-5 py-3 text-left">Desde</th>
                                    <th className="px-5 py-3 text-left">Hasta</th>
                                    <th className="px-5 py-3 text-right">Días</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {clinicalData.bedHistory.map((move, idx) => (
                                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                                        <td className="px-5 py-3">
                                            <span className="font-black text-slate-700 flex items-center gap-2">
                                                <MapPin size={12} className="text-slate-300" />
                                                {move.bedId}
                                            </span>
                                        </td>
                                        <td className="px-5 py-3 text-slate-500">{move.from.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                                        <td className="px-5 py-3 text-slate-500">
                                            {move.to ? move.to.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' }) : (
                                                <span className="text-emerald-500 font-bold uppercase text-[9px]">Actual</span>
                                            )}
                                        </td>
                                        <td className="px-5 py-3 text-right font-black text-indigo-600">{move.days}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* Right Column: Diagnosis & Devices */}
            <div className="space-y-6">
                {/* Diagnosis History */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50/30">
                        <Stethoscope size={18} className="text-rose-500" />
                        <h3 className="font-bold text-slate-700">Evolución Diagnóstica</h3>
                    </div>
                    <div className="p-5 space-y-4">
                        {clinicalData.diagnosisHistory.map((dx, idx) => (
                            <div key={idx} className="relative pl-4 border-l-2 border-rose-100 pb-2 last:pb-0">
                                <p className="text-[10px] text-slate-400 font-bold">{dx.date.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })}</p>
                                <p className="text-xs text-slate-700 mt-1 font-medium">{dx.pathology}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Invasive Devices History */}
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50/30">
                        <Activity size={18} className="text-cyan-500" />
                        <h3 className="font-bold text-slate-700">Dispositivos Invasivos</h3>
                    </div>
                    <div className="p-5 space-y-4">
                        {clinicalData.devicesHistory.map((dev, idx) => (
                            <div key={idx} className="flex items-start gap-4">
                                <div className={clsx(
                                    "w-2 h-2 rounded-full mt-1.5",
                                    dev.action === 'INSTALL' ? "bg-emerald-500" : "bg-rose-400"
                                )} />
                                <div className="flex-1">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-black text-slate-400">{dev.date.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })}</span>
                                        <span className={clsx(
                                            "text-[8px] font-black px-1.5 py-0.5 rounded",
                                            dev.action === 'INSTALL' ? "bg-emerald-100 text-emerald-700" : "bg-rose-50 text-rose-600"
                                        )}>
                                            {dev.action === 'INSTALL' ? 'INSTALADO' : 'RETIRADO'}
                                        </span>
                                    </div>
                                    <p className="text-xs font-bold text-slate-700 mt-0.5">{dev.name}</p>
                                    <p className="text-[10px] text-slate-500">{dev.details}</p>
                                </div>
                            </div>
                        ))}
                        {clinicalData.devicesHistory.length === 0 && (
                            <p className="text-xs text-slate-400 italic text-center py-4">Sin registros de dispositivos.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
