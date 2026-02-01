/**
 * Confirm Transfer Modal Component
 * Modal for confirming final transfer and integration with census
 */

import React, { useState } from 'react';
import { CheckCircle } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { TransferRequest, TRANSFER_STATUS_CONFIG } from '@/types/transfers';


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
        <BaseModal
            isOpen={true}
            onClose={onClose}
            title="Confirmar Traslado Efectuado"
            icon={<CheckCircle size={18} />}
            size="md"
            headerIconColor="text-emerald-600"
            variant="white"
            closeOnBackdrop={!isSubmitting}
        >
            <div className="space-y-4">
                {/* Warning */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
                    <strong>⚠️ Atención:</strong> Esta acción marcará al paciente como trasladado y liberará la cama automáticamente en el censo diario.
                </div>

                {/* Patient Summary */}
                <div className="bg-slate-50 p-4 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                        <h3 className="font-bold text-slate-800">{transfer.patientSnapshot.name}</h3>
                        <span className="text-sm text-slate-500">RUT: {transfer.patientSnapshot.rut}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
                        <div>
                            <span className="text-slate-400">Cama:</span> {transfer.bedId.replace('BED_', '')}
                        </div>
                        <div>
                            <span className="text-slate-400">Días hospitalizados:</span> {calculateDaysHospitalized()}
                        </div>
                        <div className="col-span-2">
                            <span className="text-slate-400">Diagnóstico:</span> {transfer.patientSnapshot.diagnosis}
                        </div>
                        <div className="col-span-2">
                            <span className="text-slate-400">Destino:</span> {transfer.destinationHospital}
                        </div>
                    </div>
                </div>

                {/* Transfer Method Selection */}
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                        Medio de Traslado *
                    </label>
                    <select
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all bg-white"
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
                    {['REQUESTED', 'SENT', 'ACCEPTED', 'TRANSFERRED'].map((status, index) => (
                        <React.Fragment key={status}>
                            <div className={`px-2 py-1 rounded-lg text-xs font-medium ${index < 3
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-emerald-500 text-white ring-2 ring-offset-1 ring-emerald-500'
                                }`}>
                                {TRANSFER_STATUS_CONFIG[status as keyof typeof TRANSFER_STATUS_CONFIG].label}
                            </div>
                            {index < 3 && <span className="text-emerald-500">✓</span>}
                        </React.Fragment>
                    ))}
                </div>

                {/* Footer Actions */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium transition-colors"
                        disabled={isSubmitting}
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleConfirm}
                        className="px-5 py-2.5 text-white bg-emerald-600 rounded-xl font-bold shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 disabled:opacity-50 transition-all active:scale-95"
                        disabled={isSubmitting || !transferMethod}
                    >
                        {isSubmitting ? 'Procesando...' : 'Confirmar Traslado'}
                    </button>
                </div>
            </div>
        </BaseModal>
    );
};
