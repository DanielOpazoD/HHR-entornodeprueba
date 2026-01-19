/**
 * Status Change Modal Component
 * Modal for confirming status changes and viewing history
 */

import React, { useState } from 'react';
import { TransferRequest, TRANSFER_STATUS_CONFIG } from '@/types/transfers';
import { getNextStatus } from '@/constants/transferConstants';

interface StatusChangeModalProps {
    transfer: TransferRequest;
    onClose: () => void;
    onConfirm: (notes?: string) => Promise<void>;
}

export const StatusChangeModal: React.FC<StatusChangeModalProps> = ({
    transfer,
    onClose,
    onConfirm
}) => {
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const nextStatus = getNextStatus(transfer.status);
    const currentConfig = TRANSFER_STATUS_CONFIG[transfer.status];
    const nextConfig = nextStatus ? TRANSFER_STATUS_CONFIG[nextStatus] : null;

    const handleConfirm = async () => {
        setIsSubmitting(true);
        try {
            await onConfirm(notes || undefined);
            onClose();
        } finally {
            setIsSubmitting(false);
        }
    };

    const formatDate = (dateString: string) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('es-CL', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    return (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-md flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b">
                    <h2 className="text-lg font-semibold text-gray-800">
                        Cambiar Estado de Traslado
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1 text-gray-400 hover:text-gray-600 rounded"
                        disabled={isSubmitting}
                    >
                        ✕
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4">
                    {/* Patient Info */}
                    <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="font-medium text-gray-800">{transfer.patientSnapshot.name}</p>
                        <p className="text-sm text-gray-500">
                            Cama {transfer.bedId.replace('BED_', '')} • {transfer.destinationHospital}
                        </p>
                    </div>

                    {/* Status Change Visualization */}
                    <div className="flex items-center justify-center gap-4 py-4">
                        <div className={`px-4 py-2 rounded-lg ${currentConfig.bgColor} ${currentConfig.color}`}>
                            {currentConfig.label}
                        </div>
                        <span className="text-2xl text-gray-400">→</span>
                        {nextConfig ? (
                            <div className={`px-4 py-2 rounded-lg ${nextConfig.bgColor} ${nextConfig.color} ring-2 ring-offset-2 ring-blue-500`}>
                                {nextConfig.label}
                            </div>
                        ) : (
                            <div className="px-4 py-2 rounded-lg bg-gray-100 text-gray-400">
                                Estado Final
                            </div>
                        )}
                    </div>

                    {/* Notes */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Notas (opcional)
                        </label>
                        <textarea
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            rows={2}
                            placeholder="Agregar observación sobre el cambio de estado..."
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            disabled={isSubmitting}
                        />
                    </div>

                    {/* History */}
                    {transfer.statusHistory && transfer.statusHistory.length > 0 && (
                        <div>
                            <h3 className="text-sm font-medium text-gray-700 mb-2">
                                Historial de Estados
                            </h3>
                            <div className="max-h-40 overflow-y-auto space-y-2">
                                {transfer.statusHistory.map((change, index) => (
                                    <div key={index} className="flex items-start gap-2 text-sm bg-gray-50 p-2 rounded">
                                        <div className="flex-1">
                                            <span className="text-gray-500">
                                                {change.from ? TRANSFER_STATUS_CONFIG[change.from].label : 'Nuevo'}
                                            </span>
                                            <span className="mx-1 text-gray-400">→</span>
                                            <span className={TRANSFER_STATUS_CONFIG[change.to].color}>
                                                {TRANSFER_STATUS_CONFIG[change.to].label}
                                            </span>
                                            {change.notes && (
                                                <p className="text-gray-500 mt-1 italic">&quot;{change.notes}&quot;</p>
                                            )}
                                        </div>
                                        <span className="text-gray-400 text-xs whitespace-nowrap">
                                            {formatDate(change.timestamp)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 p-4 border-t bg-gray-50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                        disabled={isSubmitting}
                    >
                        Cancelar
                    </button>
                    {nextStatus && (
                        <button
                            onClick={handleConfirm}
                            className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? 'Actualizando...' : `Cambiar a "${nextConfig?.label}"`}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
