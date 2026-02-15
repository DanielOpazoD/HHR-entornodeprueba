import React, { useCallback } from 'react';
import { CMAData } from '@/types';
import { useDailyRecordActions, useDailyRecordMovements } from '@/context/DailyRecordContext';
import { useConfirmDialog, useNotification } from '@/context/UIContext';
import { Trash2, Scissors, Undo2 } from 'lucide-react';
import {
    CMA_INTERVENTION_TYPES,
    executeUndoCmaController
} from '@/features/census/controllers/censusCmaController';

export const CMASection: React.FC = () => {
    const { cma } = useDailyRecordMovements() || { cma: [] };
    const { deleteCMA, updateCMA, updatePatientMultiple } = useDailyRecordActions();
    const { confirm } = useConfirmDialog();
    const { error: notifyError } = useNotification();

    const handleUpdate = (id: string, field: keyof CMAData, value: CMAData[keyof CMAData]) => {
        updateCMA(id, { [field]: value });
    };

    // Undo CMA discharge: restore patient to original bed
    const handleUndo = useCallback(async (item: CMAData) => {
        const result = await executeUndoCmaController(item, {
            confirm,
            updatePatientMultiple,
            deleteCMA
        });

        if (!result.ok) {
            notifyError('No se pudo deshacer', result.error.message);
        }
    }, [confirm, deleteCMA, notifyError, updatePatientMultiple]);

    if (!cma) return null;

    const cmaList = cma;

    return (
        <div className="card mt-6 animate-fade-in print:break-inside-avoid">
            <div className="px-4 py-3 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
                <div className="flex items-center gap-2">
                    <div className="p-2 bg-medical-50 text-medical-600 rounded-lg shadow-sm">
                        <Scissors size={18} />
                    </div>
                    <div>
                        <h2 className="text-base font-bold text-slate-800 leading-tight">
                            Hospitalización Diurna
                        </h2>
                        <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                            CMA / PMA
                        </p>
                    </div>
                </div>
            </div>

            {!cmaList.length ? (
                <div className="p-4 text-slate-400 italic text-sm text-center py-4">
                    No hay registros de Hospitalización Diurna para hoy.
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        {/* ... table content remains same ... */}
                        <thead className="bg-slate-50/50 text-slate-500 font-bold border-b border-slate-200 uppercase text-[10px] tracking-tight">
                            <tr>
                                <th className="px-3 py-2.5 w-20">Cama</th>
                                <th className="px-3 py-2.5 w-40">Tipo Intervención</th>
                                <th className="px-3 py-2.5 w-48">Paciente</th>
                                <th className="px-3 py-2.5 w-32">RUT</th>
                                <th className="px-3 py-2.5 w-14 text-center">Edad</th>
                                <th className="px-3 py-2.5 min-w-[180px]">Diagnóstico</th>
                                <th className="px-3 py-2.5 w-28">Especialidad</th>
                                <th className="px-3 py-2.5 w-20 text-center">Hora Alta</th>
                                <th className="px-3 py-2.5 w-16 text-right print:hidden">Acciones</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {cmaList.map((item) => (
                                <tr key={item.id} className="hover:bg-slate-50 group border-b border-slate-100 last:border-0">
                                    <td className="p-2">
                                        <span className="text-xs font-medium text-slate-700">
                                            {item.bedName || '-'}
                                        </span>
                                    </td>
                                    <td className="p-2">
                                        <select
                                            className="w-full p-1 border border-slate-200 hover:border-slate-300 rounded focus:border-orange-400 focus:ring-1 focus:ring-orange-400 text-xs text-slate-600 bg-white transition-colors"
                                            value={item.interventionType || 'Cirugía Mayor Ambulatoria'}
                                            onChange={(e) => handleUpdate(item.id, 'interventionType', e.target.value)}
                                        >
                                            {CMA_INTERVENTION_TYPES.map(opt => (
                                                <option key={opt} value={opt}>{opt}</option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="p-2">
                                        <span className="text-[13px] font-medium text-slate-800">
                                            {item.patientName || '-'}
                                        </span>
                                    </td>
                                    <td className="p-2">
                                        <span className="text-[11px] font-mono text-slate-500">
                                            {item.rut || '-'}
                                        </span>
                                    </td>
                                    <td className="p-2 text-center">
                                        <span className="text-[11px] text-slate-400">
                                            {item.age || '-'}
                                        </span>
                                    </td>
                                    <td className="p-2">
                                        <span className="text-[12px] text-slate-600">
                                            {item.diagnosis || '-'}
                                        </span>
                                    </td>
                                    <td className="p-2">
                                        <span className="text-xs text-slate-600">
                                            {item.specialty || '-'}
                                        </span>
                                    </td>
                                    <td className="p-2 text-center">
                                        <input
                                            type="time"
                                            step="300"
                                            className="text-xs font-medium text-slate-600 bg-green-50 px-2 py-1 rounded border border-green-200 w-20 text-center"
                                            value={item.dischargeTime || ''}
                                            onChange={(e) => handleUpdate(item.id, 'dischargeTime', e.target.value)}
                                        />
                                    </td>
                                    <td className="p-2 text-right print:hidden">
                                        <div className="flex items-center justify-end gap-1">
                                            <button
                                                onClick={() => handleUndo(item)}
                                                className="p-1 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                                title={item.originalBedId ? "Deshacer: Restaurar paciente a la cama" : "Deshacer (sin datos originales)"}
                                            >
                                                <Undo2 size={14} />
                                            </button>
                                            <button
                                                onClick={() => deleteCMA(item.id)}
                                                className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                title="Eliminar registro"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
