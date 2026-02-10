import React, { useState } from 'react';
import { XCircle, AlertCircle } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';

interface DeviceRetireModalProps {
    deviceLabel: string;
    installationDate?: string;
    currentDate?: string;
    onConfirm: (data: {
        removalDate: string;
        note: string;
    }) => void;
    onClose: () => void;
}

export const DeviceRetireModal: React.FC<DeviceRetireModalProps> = ({
    deviceLabel,
    installationDate,
    currentDate = new Date().toISOString().split('T')[0],
    onConfirm,
    onClose
}) => {
    const [removalDate, setRemovalDate] = useState(currentDate);
    const [note, setNote] = useState('');

    const handleConfirm = () => {
        onConfirm({
            removalDate,
            note
        });
    };

    return (
        <BaseModal
            isOpen={true}
            onClose={onClose}
            title={`Retirar dispositivo`}
            icon={<XCircle size={18} />}
            size="sm"
            variant="white"
            headerIconColor="text-red-600"
        >
            <div className="space-y-4">
                <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex gap-3 items-start">
                    <AlertCircle className="text-red-600 shrink-0 mt-0.5" size={16} />
                    <div className="text-xs text-red-800">
                        <p className="font-bold">Confirmar retiro de {deviceLabel}</p>
                    </div>
                </div>

                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-wider">
                        Fecha de Retiro
                    </label>
                    <input
                        type="date"
                        className="w-full p-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-medical-500 focus:outline-none transition-all shadow-sm"
                        value={removalDate}
                        min={installationDate}
                        max={currentDate}
                        onChange={(e) => setRemovalDate(e.target.value)}
                        required
                    />
                </div>

                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-2 tracking-wider">
                        Nota de Retiro
                    </label>
                    <textarea
                        className="w-full p-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-medical-500 focus:outline-none resize-none min-h-[80px] transition-all shadow-sm"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Motivo del retiro o detalles adicionales..."
                    />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!removalDate}
                        className="px-6 py-2 bg-red-600 text-white rounded-xl text-sm font-bold hover:bg-red-700 transition-all shadow-lg shadow-red-600/20 active:scale-95 disabled:opacity-50"
                    >
                        Confirmar Retiro
                    </button>
                </div>
            </div>
        </BaseModal>
    );
};
