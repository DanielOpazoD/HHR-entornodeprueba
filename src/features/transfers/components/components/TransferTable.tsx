/**
 * Transfer Table Component
 * Displays list of transfer requests with actions
 */

import React from 'react';
import { TransferRequest, TransferStatus } from '@/types/transfers';
import { TransferStatusInteraction } from './TransferStatusInteraction';
// import { calculateDaysElapsed } from '@/constants/transferConstants';
import { FileDown, Eye, Undo2, Archive } from 'lucide-react';
import clsx from 'clsx';

interface TransferTableProps {
    transfers: TransferRequest[];
    onEdit: (transfer: TransferRequest) => void;
    onStatusChange: (transfer: TransferRequest) => void;
    onQuickStatusChange: (transfer: TransferRequest, newStatus: TransferStatus) => Promise<void>;
    onMarkTransferred: (transfer: TransferRequest) => void;
    onCancel: (transfer: TransferRequest) => void;
    onGenerateDocs: (transfer: TransferRequest) => void;
    onViewDocs: (transfer: TransferRequest) => void;
    onUndo: (transfer: TransferRequest) => void;
    onArchive: (transfer: TransferRequest) => void;
    onDeleteHistoryEntry: (transfer: TransferRequest, historyIndex: number) => Promise<void>;
}

export const TransferTable: React.FC<TransferTableProps> = ({
    transfers,
    onEdit,
    onStatusChange: _onStatusChange,
    onQuickStatusChange,
    onMarkTransferred,
    onCancel,
    onGenerateDocs,
    onViewDocs,
    onUndo,
    onArchive,
    onDeleteHistoryEntry
}) => {
    if (transfers.length === 0) {
        return (
            <div className="text-center py-12 text-gray-500">
                No hay solicitudes de traslado activas
            </div>
        );
    }

    const isActive = (status: string) => status !== 'TRANSFERRED' && status !== 'CANCELLED';
    const isTransferred = (status: string) => status === 'TRANSFERRED';

    return (
        <div className="overflow-x-auto bg-white rounded-lg shadow">
            <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                    <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Estado
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Cama
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Paciente (RUT)
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Diagnóstico
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Hospital Destino
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Fecha Solicitud
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Acciones
                        </th>
                    </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                    {transfers.map((transfer) => (
                        <tr key={transfer.id} className={`hover:bg-gray-50 ${!isActive(transfer.status) ? 'opacity-60' : ''}`}>
                            <td className="px-4 py-3 whitespace-nowrap">
                                <TransferStatusInteraction
                                    transfer={transfer}
                                    onStatusChange={(status) => onQuickStatusChange(transfer, status)}
                                    onDeleteHistoryEntry={(idx) => onDeleteHistoryEntry(transfer, idx)}
                                />
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                {transfer.bedId.replace('BED_', '')}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                                <div className="text-sm font-medium text-gray-900">
                                    {transfer.patientSnapshot.name}
                                </div>
                                <div className="text-xs text-gray-500">
                                    ({transfer.patientSnapshot.rut})
                                </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">
                                {transfer.patientSnapshot.diagnosis}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                <div>{transfer.destinationHospital}</div>
                                {/* Hide Edit link for transferred patients */}
                                {isActive(transfer.status) && (
                                    <button
                                        onClick={() => onEdit(transfer)}
                                        className="text-[10px] text-blue-600 hover:text-blue-800 font-medium underline mt-0.5 block"
                                    >
                                        Editar
                                    </button>
                                )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                {new Date(transfer.requestDate).toLocaleDateString('es-CL')}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm">
                                <div className="flex items-center gap-2">
                                    {/* Active transfers: show full action set */}
                                    {isActive(transfer.status) && (
                                        <>
                                            <button
                                                onClick={() => onGenerateDocs(transfer)}
                                                className={clsx(
                                                    "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-md transition-all",
                                                    transfer.questionnaireResponses
                                                        ? "text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100"
                                                        : "text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200"
                                                )}
                                                title={transfer.questionnaireResponses ? "Seguir editando datos" : "Preparar datos para documentos"}
                                            >
                                                <FileDown size={14} />
                                                {transfer.questionnaireResponses ? "Editar" : "Preparar documentos"}
                                            </button>

                                            {transfer.questionnaireResponses && (
                                                <button
                                                    onClick={() => onViewDocs(transfer)}
                                                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md transition-all shadow-sm"
                                                    title="Ver documentos generados"
                                                >
                                                    <Eye size={14} /> Ver documentos
                                                </button>
                                            )}
                                            <button
                                                onClick={() => onMarkTransferred(transfer)}
                                                className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-md transition-colors text-lg"
                                                title="Ejecutar Traslado"
                                            >
                                                ✅
                                            </button>
                                            <button
                                                onClick={() => onCancel(transfer)}
                                                className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors text-lg"
                                                title="Cancelar traslado"
                                            >
                                                ❌
                                            </button>
                                        </>
                                    )}

                                    {/* Transferred patients: show Undo and Archive only */}
                                    {isTransferred(transfer.status) && (
                                        <>
                                            <button
                                                onClick={() => onUndo(transfer)}
                                                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-md transition-all"
                                                title="Deshacer traslado (volver a estado anterior)"
                                            >
                                                <Undo2 size={14} /> Deshacer
                                            </button>
                                            <button
                                                onClick={() => onArchive(transfer)}
                                                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-md transition-all"
                                                title="Archivar (quitar de la lista)"
                                            >
                                                <Archive size={14} /> Archivar
                                            </button>
                                        </>
                                    )}
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};
