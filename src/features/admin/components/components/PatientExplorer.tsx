import React from 'react';
import { Search, RefreshCw, ChevronRight, Users } from 'lucide-react';
import { MasterPatient } from '@/types';
import { formatDateDDMMYYYY } from '@/utils/dateUtils';
import clsx from 'clsx';

interface PatientExplorerProps {
    patients: MasterPatient[];
    searchTerm: string;
    setSearchTerm: (term: string) => void;
    isLoading: boolean;
    onSelectPatient: (patient: MasterPatient) => void;
    hasMore?: boolean;
    onLoadMore?: () => void;
}

export const PatientExplorer: React.FC<PatientExplorerProps> = ({
    patients,
    searchTerm,
    setSearchTerm,
    isLoading,
    onSelectPatient,
    hasMore,
    onLoadMore
}) => {
    // Note: Filtering is handled server-side now, but we keep a local safety filter
    const filteredPatients = patients.filter(p =>
        !searchTerm ||
        p.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.rut.includes(searchTerm)
    );

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 p-2 rounded-xl">
                <Search size={18} className="text-slate-400 ml-2" />
                <input
                    type="text"
                    placeholder="Buscar por Nombre o RUT..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="bg-transparent border-none focus:ring-0 text-sm font-medium w-full placeholder:text-slate-400"
                />
                {isLoading && <RefreshCw className="animate-spin text-blue-500 mr-2" size={16} />}
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                            <th className="px-3 py-2 font-bold text-slate-500 uppercase tracking-widest text-[9px]">Paciente</th>
                            <th className="px-3 py-2 font-bold text-slate-500 uppercase tracking-widest text-[9px]">RUT</th>
                            <th className="px-3 py-2 font-bold text-slate-500 uppercase tracking-widest text-[9px]">Últ. Movimiento</th>
                            <th className="px-3 py-2 font-bold text-slate-500 uppercase tracking-widest text-[9px]">Estado</th>
                            <th className="px-3 py-2 text-right"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filteredPatients.map((p: MasterPatient) => (
                            <tr key={p.rut} className="hover:bg-blue-50/40 transition-colors border-b border-slate-50 last:border-0 group">
                                <td className="px-3 py-1.5">
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-500 text-[10px] shadow-sm shrink-0">
                                            {p.fullName.charAt(0)}
                                        </div>
                                        <div className="font-bold text-slate-700 text-xs truncate max-w-[200px]">{p.fullName}</div>
                                    </div>
                                </td>
                                <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500">
                                    {p.rut}
                                </td>
                                <td className="px-3 py-1.5">
                                    <div className="flex flex-col gap-0.5">
                                        <div className="flex items-center gap-1.5 text-[10px] text-slate-600 font-medium">
                                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                            <span>Ing: {formatDateDDMMYYYY(p.lastAdmission)}</span>
                                        </div>
                                        {p.lastDischarge && (
                                            <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                <span>Egr: {formatDateDDMMYYYY(p.lastDischarge)}</span>
                                            </div>
                                        )}
                                    </div>
                                </td>
                                <td className="px-3 py-1.5">
                                    <span className={clsx(
                                        "px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-tight",
                                        p.vitalStatus === 'Fallecido'
                                            ? "bg-slate-100 text-slate-600"
                                            : "bg-emerald-100 text-emerald-700"
                                    )}>
                                        {p.vitalStatus || 'Vivo'}
                                    </span>
                                </td>
                                <td className="px-3 py-1.5 text-right">
                                    <button
                                        onClick={() => onSelectPatient(p)}
                                        className="p-1.5 text-slate-300 hover:text-blue-600 hover:bg-white rounded-lg transition-all"
                                        aria-label="Ver detalles"
                                    >
                                        <ChevronRight size={16} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {patients.length === 0 && !isLoading && (
                    <div className="p-8 text-center bg-slate-50/50">
                        <Users size={32} className="mx-auto text-slate-300 mb-2" />
                        <p className="text-sm text-slate-500 font-medium">No hay pacientes sincronizados en la base maestra.</p>
                        <p className="text-xs text-slate-400">Ve a la pestaña de Sincronización para analizar el historial.</p>
                    </div>
                )}
            </div>

            {hasMore && (
                <div className="flex justify-center mt-4">
                    <button
                        onClick={onLoadMore}
                        disabled={isLoading}
                        className="px-6 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-500 hover:bg-white hover:text-blue-600 hover:border-blue-200 transition-all shadow-sm active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                    >
                        {isLoading ? (
                            <span className="flex items-center gap-2">
                                <RefreshCw size={14} className="animate-spin" /> Cargando...
                            </span>
                        ) : 'Cargar más registros'}
                    </button>
                </div>
            )}
        </div>
    );
};
