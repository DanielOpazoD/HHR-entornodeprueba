/**
 * Cancel Transfer Modal Component
 * Modal for cancelling a transfer request with justification
 */

import React, { useState } from 'react';
import { XCircle } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
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
        <BaseModal
            isOpen={true}
            onClose={onClose}
            title="Cancelar Solicitud de Traslado"
            icon={<XCircle size={18} />}
            size="md"
            headerIconColor="text-red-600"
            variant="white"
            closeOnBackdrop={!isSubmitting}
        >
            <div className="space-y-4">
                {/* Warning */}
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800">
                    <strong>⚠️ Atención:</strong> Esta acción cancelará la solicitud de traslado. El paciente permanecerá hospitalizado y la cama no se liberará.
                </div>

                {/* Patient Info */}
                <div className="bg-slate-50 p-3 rounded-xl">
                    <p className="font-bold text-slate-800">{transfer.patientSnapshot.name}</p>
                    <p className="text-sm text-slate-500">
                        Cama {transfer.bedId.replace('BED_', '')} • {transfer.destinationHospital}
                    </p>
                    <p className="text-sm text-slate-500 mt-1">
                        Estado actual: <span className={TRANSFER_STATUS_CONFIG[transfer.status].color}>
                            {TRANSFER_STATUS_CONFIG[transfer.status].label}
                        </span>
                    </p>
                </div>

                {/* Reason */}
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                        Justificación de la cancelación *
                    </label>
                    <textarea
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all resize-none"
                        rows={3}
                        placeholder="Explique el motivo por el cual se cancela el traslado..."
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        disabled={isSubmitting}
                    />
                </div>

                {/* Footer Actions */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium transition-colors"
                        disabled={isSubmitting}
                    >
                        Volver
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="px-5 py-2.5 text-white bg-red-600 rounded-xl font-bold shadow-lg shadow-red-600/20 hover:bg-red-700 disabled:opacity-50 transition-all active:scale-95"
                        disabled={isSubmitting || !reason.trim()}
                    >
                        {isSubmitting ? 'Cancelando...' : 'Cancelar Traslado'}
                    </button>
                </div>
            </div>
        </BaseModal>
    );
};
