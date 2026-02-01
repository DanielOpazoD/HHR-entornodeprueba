import React from 'react';
import { Conflict } from '@/hooks/usePatientAnalysis';
import { formatDateDDMMYYYY } from '@/utils/dateUtils';
import { RefreshCw, History, ShieldCheck, CheckCircle, Info, Check } from 'lucide-react';
import clsx from 'clsx';

interface ConflictPanelProps {
    conflicts: Conflict[];
    onResolve: (rut: string, correctName: string, harmonizeHistory: boolean) => void;
    isHarmonizing?: boolean;
}

export const ConflictPanel: React.FC<ConflictPanelProps> = ({ conflicts, onResolve, isHarmonizing }) => {
    const [applyToHistory, setApplyToHistory] = React.useState(true);

    return (
        <div className="space-y-4">
            {isHarmonizing && (
                <div className="flex items-center justify-center gap-3 p-4 bg-blue-600 text-white rounded-xl shadow-lg animate-pulse mb-4">
                    <RefreshCw className="animate-spin" size={20} />
                    <span className="text-sm font-black uppercase tracking-widest">Armonizando registros históricos... por favor espere</span>
                </div>
            )}

            {conflicts.length > 0 && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white rounded-lg border border-slate-200 text-blue-600">
                            <History size={18} />
                        </div>
                        <div>
                            <h4 className="text-xs font-black text-slate-800 uppercase tracking-tight">Armonización Profunda</h4>
                            <p className="text-[10px] text-slate-500 font-medium">Al unificar, ¿desea corregir también los censos diarios antiguos?</p>
                        </div>
                    </div>
                    <button
                        onClick={() => setApplyToHistory(!applyToHistory)}
                        className={clsx(
                            "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all border",
                            applyToHistory
                                ? "bg-emerald-50 border-emerald-200 text-emerald-700 shadow-sm shadow-emerald-100"
                                : "bg-white border-slate-200 text-slate-400"
                        )}
                    >
                        <ShieldCheck size={16} className={applyToHistory ? "text-emerald-500" : "text-slate-300"} />
                        {applyToHistory ? "SI (Corrección Histórica Activa)" : "NO (Solo Maestro)"}
                    </button>
                </div>
            )}

            {conflicts.length === 0 ? (
                <div className="p-12 text-center bg-slate-50 rounded-2xl border border-slate-200 border-dashed">
                    <CheckCircle size={48} className="mx-auto text-emerald-400 mb-4" />
                    <h3 className="text-lg font-bold text-slate-800 mb-1">Sin Conflictos</h3>
                    <p className="text-sm text-slate-500">No se detectaron inconsistencias de datos en el historial analizado.</p>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center gap-2 p-3 bg-white border border-slate-100 rounded-xl text-slate-400">
                        <Info size={16} />
                        <span className="text-[10px] font-bold uppercase">Inconsistencias de Identidad detectadas</span>
                    </div>
                    {conflicts.map((c, i) => (
                        <div key={i} className="p-4 bg-white border border-slate-200 rounded-xl hover:border-amber-300 transition-colors shadow-sm">
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <div className="font-black text-slate-800 text-sm font-mono tracking-tight">{c.rut}</div>
                                    <div className="text-[10px] text-amber-600 font-bold uppercase tracking-wider">{c.description}</div>
                                </div>
                                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-black">{c.records.length} Ocurrencias</span>
                            </div>

                            <div className="space-y-2 mb-4">
                                <p className="text-[10px] font-bold text-slate-400 uppercase">Seleccione el nombre correcto:</p>
                                <div className="grid grid-cols-1 gap-2">
                                    {c.options.map((option) => (
                                        <button
                                            key={option}
                                            disabled={isHarmonizing}
                                            onClick={() => onResolve(c.rut, option, applyToHistory)}
                                            className="flex items-center justify-between p-2.5 text-left text-xs bg-slate-50 border border-slate-200 rounded-lg hover:border-blue-400 hover:bg-blue-50 transition-all group disabled:opacity-50"
                                        >
                                            <span className="font-semibold text-slate-700">{option}</span>
                                            <div className="px-2 py-1 bg-white border border-slate-200 rounded text-[9px] font-bold text-blue-600 group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-600 transition-colors flex items-center gap-1">
                                                <Check size={10} /> Unificar {applyToHistory && "& Corregir"}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="pt-3 border-t border-slate-100 italic">
                                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">Fechas detectadas:</p>
                                <div className="flex flex-wrap gap-1.5">
                                    {c.records.map((r) => (
                                        <span key={r} className="text-[9px] font-bold text-slate-500 px-2 py-0.5 bg-slate-50 border border-slate-100 rounded-md">
                                            {formatDateDDMMYYYY(r)}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
