/**
 * Cancel Transfer Modal Component
 * Modal for cancelling a transfer request with justification
 */

import React, { useState } from 'react';
import { TransferRequest, TRANSFER_STATUS_CONFIG } from '@/types/transfers';

interface CancelTransferModalProps {
    transfer: TransferRequest;
    onClose: () => void;
    onConfirm: (reason: string) => Promise<void>;
}

export const CancelTransferModal: React.FC<CancelTransferModalProps> = ({
    transfer,
    onClose,
    onConfirm
}) => {
    const [reason, setReason] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleConfirm = async () => {
        if (!reason.trim()) {
            alert('Debe ingresar una justificación para cancelar el traslado');
            return;
        }

        setIsSubmitting(true);
        try {
            await onConfirm(reason);
            onClose();
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b bg-red-50">
                    <h2 className="text-lg font-semibold text-red-800">
                        ❌ Cancelar Solicitud de Traslado
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
                    {/* Warning */}
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-800">
                        <strong>⚠️ Atención:</strong> Esta acción cancelará la solicitud de traslado. El paciente permanecerá hospitalizado y la cama no se liberará.
                    </div>

                    {/* Patient Info */}
                    <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="font-medium text-gray-800">{transfer.patientSnapshot.name}</p>
                        <p className="text-sm text-gray-500">
                            Cama {transfer.bedId.replace('BED_', '')} • {transfer.destinationHospital}
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                            Estado actual: <span className={TRANSFER_STATUS_CONFIG[transfer.status].color}>
                                {TRANSFER_STATUS_CONFIG[transfer.status].label}
                            </span>
                        </p>
                    </div>

                    {/* Reason */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Justificación de la cancelación *
                        </label>
                        <textarea
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                            rows={3}
                            placeholder="Explique el motivo por el cual se cancela el traslado..."
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            disabled={isSubmitting}
                        />
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 p-4 border-t bg-gray-50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                        disabled={isSubmitting}
                    >
                        Volver
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
                        disabled={isSubmitting || !reason.trim()}
                    >
                        {isSubmitting ? 'Cancelando...' : 'Cancelar Traslado'}
                    </button>
                </div>
            </div>
        </div>
    );
};
