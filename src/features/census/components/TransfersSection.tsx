import React from 'react';
import clsx from 'clsx';

import { useDailyRecordActions, useDailyRecordMovements } from '@/context/DailyRecordContext';
import { useCensusActionCommands } from './CensusActionsContext';
import { ArrowRightLeft } from 'lucide-react';
import { CensusMovementActionsCell } from '@/features/census/components/CensusMovementActionsCell';
import {
    buildTransferRowActions,
    getTransferCenterLabel,
    getTransferEscortLabel,
    TRANSFERS_TABLE_HEADERS
} from '@/features/census/controllers/censusTransfersTableController';
import {
    executeTransferTimeChangeController,
    resolveTransfersSectionState
} from '@/features/census/controllers/censusTransfersSectionController';

// Interface for props removed as data comes from context

export const TransfersSection: React.FC = () => {
    const { transfers } = useDailyRecordMovements() || { transfers: [] };
    const { undoTransfer, deleteTransfer, updateTransfer } = useDailyRecordActions();
    const { handleEditTransfer } = useCensusActionCommands();
    const sectionState = resolveTransfersSectionState(transfers);

    if (!sectionState.isRenderable) return null;

    const handleTimeChange = (id: string, newTime: string) => {
        executeTransferTimeChangeController(
            sectionState.transfers,
            id,
            newTime,
            updateTransfer
        );
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
                {sectionState.isEmpty ? (
                    <p className="text-slate-400 italic text-sm text-center py-4">No hay traslados registrados para hoy.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm print:text-xs">
                            <thead className="bg-slate-50/50 text-slate-500 font-bold border-b border-slate-200 uppercase text-[10px] tracking-tight">
                                <tr>
                                    {TRANSFERS_TABLE_HEADERS.map((header) => (
                                        <th
                                            key={header.label}
                                            className={clsx('px-3 py-2.5', header.className)}
                                        >
                                            {header.label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sectionState.transfers.map(t => {
                                    const escortLabel = getTransferEscortLabel(t);

                                    return (
                                        <tr key={t.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 print:border-slate-300">
                                            <td className="p-2 font-medium text-slate-700">{t.bedName} <span className="text-[10px] text-slate-400">({t.bedType})</span></td>
                                            <td className="p-2 text-slate-800 font-medium">{t.patientName}</td>
                                            <td className="p-2 font-mono text-xs text-slate-500">{t.rut}</td>
                                            <td className="p-2 text-slate-600">{t.diagnosis}</td>
                                            <td className="p-2 text-slate-600">{t.evacuationMethod}</td>
                                            <td className="p-2 text-slate-600">
                                                <div>{getTransferCenterLabel(t)}</div>
                                                {escortLabel && (
                                                    <div className="text-[10px] text-slate-400 mt-0.5 italic">{escortLabel}</div>
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
                                            <CensusMovementActionsCell
                                                actions={buildTransferRowActions(t, {
                                                    undoTransfer,
                                                    editTransfer: handleEditTransfer,
                                                    deleteTransfer
                                                })}
                                            />
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};
