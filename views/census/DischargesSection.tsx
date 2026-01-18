import React from 'react';
import { DischargeData } from '@/types';
import { useDailyRecordData, useDailyRecordActions } from '@/context/DailyRecordContext';
import { useCensusActions } from './CensusActionsContext';
import { CheckCircle, RotateCcw, Pencil, Trash2 } from 'lucide-react';
import clsx from 'clsx';

// Interface for props removed as data comes from context

export const DischargesSection: React.FC = () => {
    const { record } = useDailyRecordData();
    const { undoDischarge, deleteDischarge } = useDailyRecordActions();
    const { handleEditDischarge } = useCensusActions();

    if (!record) return null;
    const discharges = record.discharges || [];

    return (
        <div className="card mt-6 animate-fade-in print:p-2 print:border-t-2 print:border-slate-800 print:shadow-none">
            <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-green-50 text-green-600 rounded-lg shadow-sm">
                        <CheckCircle size={18} />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-slate-800 leading-tight">
                            Altas
                        </h2>
                    </div>
                </div>
            </div>

            <div className="p-4">
                {(!discharges || discharges.length === 0) ? (
                    <p className="text-slate-400 italic text-sm text-center py-4">No hay altas registradas para este día.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm print:text-xs">
                            <thead className="bg-slate-50/50 text-slate-500 font-bold border-b border-slate-200 uppercase text-[10px] tracking-tight">
                                <tr>
                                    <th className="px-3 py-2.5">Cama Origen</th>
                                    <th className="px-3 py-2.5">Paciente</th>
                                    <th className="px-3 py-2.5">RUT / ID</th>
                                    <th className="px-3 py-2.5">Diagnóstico Clínico</th>
                                    <th className="px-3 py-2.5">Tipo Alta</th>
                                    <th className="px-3 py-2.5">Estado</th>
                                    <th className="px-3 py-2.5 text-right print:hidden">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {discharges.map(d => (
                                    <tr key={d.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 print:border-slate-300">
                                        <td className="p-2 font-medium text-slate-700">{d.bedName} <span className="text-[10px] text-slate-400">({d.bedType})</span></td>
                                        <td className="p-2 text-slate-800 font-medium">{d.patientName}</td>
                                        <td className="p-2 font-mono text-xs text-slate-500">{d.rut}</td>
                                        <td className="p-2 text-slate-600">{d.diagnosis}</td>
                                        <td className="p-2 text-xs text-slate-500">{d.dischargeType || '-'}</td>
                                        <td className="p-2">
                                            <span className={clsx("px-2 py-1 rounded-full text-[11px] font-bold print:border print:border-slate-400", d.status === 'Fallecido' ? 'bg-black text-white' : 'bg-green-100 text-green-700')}>
                                                {d.status}
                                            </span>
                                        </td>
                                        <td className="p-2 flex justify-end gap-2 print:hidden">
                                            <button onClick={() => undoDischarge(d.id)} className="text-slate-400 hover:text-slate-600" title="Deshacer (Restaurar a Cama)">
                                                <RotateCcw size={14} />
                                            </button>
                                            <button onClick={() => handleEditDischarge(d)} className="text-medical-500 hover:text-medical-700" title="Editar">
                                                <Pencil size={14} />
                                            </button>
                                            <button onClick={() => deleteDischarge(d.id)} className="text-red-400 hover:text-red-600" title="Eliminar Registro">
                                                <Trash2 size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};
