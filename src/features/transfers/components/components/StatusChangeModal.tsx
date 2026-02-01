/**
 * Status Change Modal Component
 * Modal for confirming status changes and viewing history
 */

import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
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
        <BaseModal
            isOpen={true}
            onClose={onClose}
            title="Cambiar Estado de Traslado"
            icon={<RefreshCw size={18} />}
            size="md"
            headerIconColor="text-blue-600"
            variant="white"
            closeOnBackdrop={!isSubmitting}
        >
            <div className="space-y-4">
                {/* Patient Info */}
                <div className="bg-slate-50 p-3 rounded-xl">
                    <p className="font-bold text-slate-800">{transfer.patientSnapshot.name}</p>
                    <p className="text-sm text-slate-500">
                        Cama {transfer.bedId.replace('BED_', '')} • {transfer.destinationHospital}
                    </p>
                </div>

                {/* Status Change Visualization */}
                <div className="flex items-center justify-center gap-4 py-4">
                    <div className={`px-4 py-2 rounded-xl font-medium ${currentConfig.bgColor} ${currentConfig.color}`}>
                        {currentConfig.label}
                    </div>
                    <span className="text-2xl text-slate-400">→</span>
                    {nextConfig ? (
                        <div className={`px-4 py-2 rounded-xl font-medium ${nextConfig.bgColor} ${nextConfig.color} ring-2 ring-offset-2 ring-blue-500`}>
                            {nextConfig.label}
                        </div>
                    ) : (
                        <div className="px-4 py-2 rounded-xl bg-slate-100 text-slate-400 font-medium">
                            Estado Final
                        </div>
                    )}
                </div>

                {/* Notes */}
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                        Notas (opcional)
                    </label>
                    <textarea
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none"
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
                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                            Historial de Estados
                        </h3>
                        <div className="max-h-40 overflow-y-auto space-y-2">
                            {transfer.statusHistory.map((change, index) => (
                                <div key={index} className="flex items-start gap-2 text-sm bg-slate-50 p-2.5 rounded-xl">
                                    <div className="flex-1">
                                        <span className="text-slate-500">
                                            {change.from ? TRANSFER_STATUS_CONFIG[change.from].label : 'Nuevo'}
                                        </span>
                                        <span className="mx-1 text-slate-400">→</span>
                                        <span className={TRANSFER_STATUS_CONFIG[change.to].color}>
                                            {TRANSFER_STATUS_CONFIG[change.to].label}
                                        </span>
                                        {change.notes && (
                                            <p className="text-slate-500 mt-1 italic">&quot;{change.notes}&quot;</p>
                                        )}
                                    </div>
                                    <span className="text-slate-400 text-xs whitespace-nowrap">
                                        {formatDate(change.timestamp)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Footer Actions */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium transition-colors"
                        disabled={isSubmitting}
                    >
                        Cancelar
                    </button>
                    {nextStatus && (
                        <button
                            onClick={handleConfirm}
                            className="px-5 py-2.5 text-white bg-blue-600 rounded-xl font-bold shadow-lg shadow-blue-600/20 hover:bg-blue-700 disabled:opacity-50 transition-all active:scale-95"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? 'Actualizando...' : `Cambiar a "${nextConfig?.label}"`}
                        </button>
                    )}
                </div>
            </div>
        </BaseModal>
    );
};
