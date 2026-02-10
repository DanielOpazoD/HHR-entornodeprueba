import React from 'react';

import { useDailyRecordActions, useDailyRecordMovements } from '@/context/DailyRecordContext';
import { useCensusActions } from './CensusActionsContext';
import { ArrowRightLeft, RotateCcw, Pencil, Trash2 } from 'lucide-react';

// Interface for props removed as data comes from context

export const TransfersSection: React.FC = () => {
    const { transfers } = useDailyRecordMovements() || { transfers: [] };
    const { undoTransfer, deleteTransfer, updateTransfer } = useDailyRecordActions();
    const { handleEditTransfer } = useCensusActions();

    if (!transfers) return null;

    const handleTimeChange = (id: string, newTime: string) => {
        const transfer = transfers.find(t => t.id === id);
        if (transfer) {
            updateTransfer(id, {
                evacuationMethod: transfer.evacuationMethod,
                receivingCenter: transfer.receivingCenter,
                receivingCenterOther: transfer.receivingCenterOther,
                transferEscort: transfer.transferEscort,
                time: newTime
            });
        }
    };

    return (
        <div className="card mt-6 animate-fade-in print:p-2 print:border-t-2 print:border-slate-800 print:shadow-none">
            <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg shadow-sm">
                        <ArrowRightLeft size={18} />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-slate-800 leading-tight">
                            Traslados
                        </h2>
                    </div>
                </div>
            </div>

            <div className="p-4">
                {(!transfers || transfers.length === 0) ? (
                    <p className="text-slate-400 italic text-sm text-center py-4">No hay traslados registrados para hoy.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm print:text-xs">
                            <thead className="bg-slate-50/50 text-slate-500 font-bold border-b border-slate-200 uppercase text-[10px] tracking-tight">
                                <tr>
                                    <th className="px-3 py-2.5">Cama Origen</th>
                                    <th className="px-3 py-2.5">Paciente</th>
                                    <th className="px-3 py-2.5">RUT / ID</th>
                                    <th className="px-3 py-2.5">Diagnóstico</th>
                                    <th className="px-3 py-2.5">Medio</th>
                                    <th className="px-3 py-2.5">Centro Destino</th>
                                    <th className="px-3 py-2.5 text-center">Hora</th>
                                    <th className="px-3 py-2.5 text-right print:hidden">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {transfers.map(t => (
                                    <tr key={t.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 print:border-slate-300">
                                        <td className="p-2 font-medium text-slate-700">{t.bedName} <span className="text-[10px] text-slate-400">({t.bedType})</span></td>
                                        <td className="p-2 text-slate-800 font-medium">{t.patientName}</td>
                                        <td className="p-2 font-mono text-xs text-slate-500">{t.rut}</td>
                                        <td className="p-2 text-slate-600">{t.diagnosis}</td>
                                        <td className="p-2 text-slate-600">{t.evacuationMethod}</td>
                                        <td className="p-2 text-slate-600">
                                            <div>{t.receivingCenter === 'Otro' ? t.receivingCenterOther : t.receivingCenter}</div>
                                            {t.transferEscort && t.evacuationMethod !== 'Aerocardal' && (
                                                <div className="text-[10px] text-slate-400 mt-0.5 italic">Acompaña: {t.transferEscort}</div>
                                            )}
                                        </td>
                                        <td className="p-2 text-center">
                                            <input
                                                type="time"
                                                step="300"
                                                className="text-xs font-medium text-slate-600 bg-blue-50 px-2 py-1 rounded border border-blue-200 w-20 text-center"
                                                value={t.time || ''}
                                                onChange={(e) => handleTimeChange(t.id, e.target.value)}
                                            />
                                        </td>
                                        <td className="p-2 flex justify-end gap-2 print:hidden">
                                            <button onClick={() => undoTransfer(t.id)} className="text-slate-400 hover:text-slate-600" title="Deshacer (Restaurar a Cama)">
                                                <RotateCcw size={14} />
                                            </button>
                                            <button onClick={() => handleEditTransfer(t)} className="text-medical-500 hover:text-medical-700" title="Editar">
                                                <Pencil size={14} />
                                            </button>
                                            <button onClick={() => deleteTransfer(t.id)} className="text-red-400 hover:text-red-600" title="Eliminar Registro">
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
