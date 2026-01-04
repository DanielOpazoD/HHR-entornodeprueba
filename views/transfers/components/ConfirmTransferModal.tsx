/**
 * Confirm Transfer Modal Component
 * Modal for confirming final transfer and integration with census
 */

import React, { useState } from 'react';
import { TransferRequest, TRANSFER_STATUS_CONFIG } from '@/types/transfers';
import { TRANSFER_REASONS } from '@/constants/transferConstants';

interface ConfirmTransferModalProps {
    transfer: TransferRequest;
    onClose: () => void;
    onConfirm: (transferMethod: string) => Promise<void>;
}

// Transfer methods (modes of transportation)
const TRANSFER_METHODS = [
    'Avión comercial',
    'Aerocardal',
    'Avión FACH',
    'Barco',
    'Helicóptero',
    'Otro'
] as const;

export const ConfirmTransferModal: React.FC<ConfirmTransferModalProps> = ({
    transfer,
    onClose,
    onConfirm
}) => {
    const [transferMethod, setTransferMethod] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleConfirm = async () => {
        if (!transferMethod) {
            alert('Por favor seleccione el medio de traslado');
            return;
        }

        setIsSubmitting(true);
        try {
            await onConfirm(transferMethod);
            onClose();
        } finally {
            setIsSubmitting(false);
        }
    };

    const calculateDaysHospitalized = () => {
        const admission = new Date(transfer.patientSnapshot.admissionDate);
        const now = new Date();
        const diffTime = Math.abs(now.getTime() - admission.getTime());
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b bg-green-50">
                    <h2 className="text-lg font-semibold text-green-800">
                        ✅ Confirmar Traslado Efectuado
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
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
                        <strong>⚠️ Atención:</strong> Esta acción marcará al paciente como trasladado y liberará la cama automáticamente en el censo diario.
                    </div>

                    {/* Patient Summary */}
                    <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                        <div className="flex items-center justify-between">
                            <h3 className="font-medium text-gray-800">{transfer.patientSnapshot.name}</h3>
                            <span className="text-sm text-gray-500">RUT: {transfer.patientSnapshot.rut}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-sm text-gray-600">
                            <div>
                                <span className="text-gray-400">Cama:</span> {transfer.bedId.replace('BED_', '')}
                            </div>
                            <div>
                                <span className="text-gray-400">Días hospitalizados:</span> {calculateDaysHospitalized()}
                            </div>
                            <div className="col-span-2">
                                <span className="text-gray-400">Diagnóstico:</span> {transfer.patientSnapshot.diagnosis}
                            </div>
                            <div className="col-span-2">
                                <span className="text-gray-400">Destino:</span> {transfer.destinationHospital}
                            </div>
                        </div>
                    </div>

                    {/* Transfer Method Selection */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Medio de Traslado *
                        </label>
                        <select
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                            value={transferMethod}
                            onChange={(e) => setTransferMethod(e.target.value)}
                            disabled={isSubmitting}
                        >
                            <option value="">Seleccionar medio...</option>
                            {TRANSFER_METHODS.map(method => (
                                <option key={method} value={method}>{method}</option>
                            ))}
                        </select>
                    </div>

                    {/* Status Flow Completed */}
                    <div className="flex items-center justify-center gap-2 py-2">
                        {['REQUESTED', 'RECEIVED', 'ACCEPTED', 'TRANSFERRED'].map((status, index) => (
                            <React.Fragment key={status}>
                                <div className={`px-2 py-1 rounded text-xs ${index < 3
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-green-500 text-white ring-2 ring-offset-1 ring-green-500'
                                    }`}>
                                    {TRANSFER_STATUS_CONFIG[status as keyof typeof TRANSFER_STATUS_CONFIG].label}
                                </div>
                                {index < 3 && <span className="text-green-500">✓</span>}
                            </React.Fragment>
                        ))}
                    </div>
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
                    <button
                        onClick={handleConfirm}
                        className="px-4 py-2 text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50"
                        disabled={isSubmitting || !transferMethod}
                    >
                        {isSubmitting ? 'Procesando...' : 'Confirmar Traslado'}
                    </button>
                </div>
            </div>
        </div>
    );
};
