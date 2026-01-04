/**
 * Transfer Table Component
 * Displays list of transfer requests with actions
 */

import React from 'react';
import { TransferRequest } from '@/types/transfers';
import { TransferStatusBadge } from './TransferStatusBadge';
import { calculateDaysElapsed } from '@/constants/transferConstants';

interface TransferTableProps {
    transfers: TransferRequest[];
    onEdit: (transfer: TransferRequest) => void;
    onStatusChange: (transfer: TransferRequest) => void;
    onMarkTransferred: (transfer: TransferRequest) => void;
    onCancel: (transfer: TransferRequest) => void;
}

export const TransferTable: React.FC<TransferTableProps> = ({
    transfers,
    onEdit,
    onStatusChange,
    onMarkTransferred,
    onCancel
}) => {
    if (transfers.length === 0) {
        return (
            <div className="text-center py-12 text-gray-500">
                No hay solicitudes de traslado activas
            </div>
        );
    }

    const isActive = (status: string) => status !== 'TRANSFERRED' && status !== 'CANCELLED';

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
                            Nombre
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            RUT
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
                            Días
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
                                <TransferStatusBadge
                                    status={transfer.status}
                                    clickable={isActive(transfer.status)}
                                    onClick={() => onStatusChange(transfer)}
                                />
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                                {transfer.bedId.replace('BED_', '')}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                                {transfer.patientSnapshot.name}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                {transfer.patientSnapshot.rut}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">
                                {transfer.patientSnapshot.diagnosis}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                {transfer.destinationHospital}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                {new Date(transfer.requestDate).toLocaleDateString('es-CL')}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                                <span className={`font-medium ${calculateDaysElapsed(transfer.requestDate) > 3 ? 'text-red-600' : 'text-gray-600'}`}>
                                    {calculateDaysElapsed(transfer.requestDate)}
                                </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm">
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => onEdit(transfer)}
                                        className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                                        title="Ver/Editar"
                                    >
                                        📄
                                    </button>
                                    {isActive(transfer.status) && (
                                        <>
                                            <button
                                                onClick={() => onMarkTransferred(transfer)}
                                                className="p-1.5 text-gray-500 hover:text-emerald-600 hover:bg-emerald-50 rounded"
                                                title="Marcar trasladado"
                                            >
                                                ✅
                                            </button>
                                            <button
                                                onClick={() => onCancel(transfer)}
                                                className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                                                title="Cancelar traslado"
                                            >
                                                ❌
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
