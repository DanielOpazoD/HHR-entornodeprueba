import React from 'react';
import { ChevronRight, Heart, MapPin, Activity, UploadCloud, CheckCircle, Clock } from 'lucide-react';
import { MasterPatient, HospitalizationEvent } from '@/types';
import { formatDateDDMMYYYY } from '@/utils/dateUtils';
import clsx from 'clsx';

interface PatientDetailModalProps {
    patient: MasterPatient;
    onClose: () => void;
}

export const PatientDetailModal: React.FC<PatientDetailModalProps> = ({
    patient,
    onClose
}) => {
    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
                <div className="p-6 bg-[#0B1120] text-white relative">
                    <button
                        onClick={onClose}
                        className="absolute top-6 right-6 w-8 h-8 flex items-center justify-center bg-white/10 hover:bg-white/20 rounded-full transition-colors z-20"
                        aria-label="Cerrar"
                    >
                        <ChevronRight className="rotate-90 md:rotate-0" size={20} />
                    </button>

                    <div className="flex items-center gap-5 relative z-10">
                        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-3xl font-black shadow-lg shadow-blue-900/40">
                            {patient.fullName.charAt(0)}
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-3 mb-1">
                                <h2 className="text-2xl font-black leading-tight tracking-tight">{patient.fullName}</h2>
                                <div className="px-2 py-0.5 bg-blue-500/20 border border-blue-500/30 rounded text-[10px] font-black text-blue-400 uppercase tracking-widest">
                                    {patient.hospitalizations?.length || 0} Eventos
                                </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-slate-400 text-[11px] font-bold">
                                <span className="font-mono bg-white/5 px-2 py-0.5 rounded text-white italic">{patient.rut}</span>
                                <span className="flex items-center gap-1">
                                    <Heart size={14} className={patient.vitalStatus === 'Fallecido' ? "text-slate-500" : "text-emerald-400 shadow-emerald-400/50 drop-shadow-sm"} />
                                    {patient.vitalStatus || 'Vivo'}
                                </span>
                                <span className="flex items-center gap-1 uppercase tracking-widest">
                                    <MapPin size={12} className="text-blue-400" /> {patient.forecast || 'SIN PREVISIÓN'}
                                </span>
                                {patient.gender && (
                                    <span className="flex items-center gap-1 uppercase tracking-widest">
                                        <Activity size={12} className="text-indigo-400" /> {patient.gender}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.25em] mb-6 flex items-center gap-2">
                        <Activity size={14} className="text-blue-500" /> Línea de Tiempo Clínica
                    </h3>

                    <div className="relative space-y-4">
                        <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-slate-200/60" />

                        {!patient.hospitalizations || patient.hospitalizations.length === 0 ? (
                            <div className="text-center py-12 text-slate-400">
                                <Clock size={32} className="mx-auto mb-2 opacity-30" />
                                <p className="text-xs font-bold uppercase tracking-widest">Sin registros históricos</p>
                            </div>
                        ) : (
                            patient.hospitalizations
                                .sort((a, b) => b.date.localeCompare(a.date))
                                .map((ev: HospitalizationEvent, idx: number) => (
                                    <div key={idx} className="relative pl-8">
                                        <div className={clsx(
                                            "absolute left-0 top-1.5 w-6 h-6 rounded-lg flex items-center justify-center border-2 border-white shadow-sm z-10",
                                            ev.type === 'Ingreso' ? "bg-blue-600 text-white" :
                                                ev.type === 'Egreso' ? "bg-emerald-500 text-white" :
                                                    ev.type === 'Traslado' ? "bg-amber-500 text-white" :
                                                        "bg-slate-800 text-white"
                                        )}>
                                            {ev.type === 'Ingreso' && <UploadCloud size={12} className="rotate-180" />}
                                            {ev.type === 'Egreso' && <CheckCircle size={12} />}
                                            {ev.type === 'Traslado' && <Activity size={12} />}
                                            {ev.type === 'Fallecimiento' && <Heart size={12} />}
                                        </div>

                                        <div className="bg-white p-3 rounded-xl border border-slate-200/60 shadow-sm transition-all hover:border-blue-200">
                                            <div className="flex items-center justify-between gap-2 mb-2">
                                                <span className="text-xs font-black text-slate-800 uppercase tracking-tight">{ev.type}</span>
                                                <span className="text-[9px] font-black text-slate-400 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100 flex items-center gap-1.5">
                                                    <Clock size={10} /> {formatDateDDMMYYYY(ev.date)}
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                                                <div className="space-y-1">
                                                    <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Diagnóstico</div>
                                                    <div className="text-[11px] text-slate-600 font-bold leading-snug line-clamp-2">{ev.diagnosis}</div>
                                                </div>

                                                <div className="flex flex-wrap items-end justify-end gap-1.5">
                                                    {ev.bedName && (
                                                        <div className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[9px] font-black border border-slate-200">
                                                            CAMA: {ev.bedName}
                                                        </div>
                                                    )}
                                                    {ev.receivingCenter && (
                                                        <div className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded text-[9px] font-black border border-amber-100">
                                                            DESTINO: {ev.receivingCenter}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                        )}
                    </div>
                </div>

                <div className="p-4 bg-white border-t border-slate-100 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 bg-slate-900 text-white font-bold rounded-xl text-sm transition-all hover:bg-slate-800 active:scale-95 shadow-lg shadow-slate-200"
                    >
                        Cerrar Explorer
                    </button>
                </div>
            </div>
        </div>
    );
};
