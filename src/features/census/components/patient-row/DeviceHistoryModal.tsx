/**
 * DeviceHistoryModal
 * Detailed history management for medical devices (VVP, CUP, CVC, etc.)
 */

import React, { useState } from 'react';
import {
    Calendar,
    MapPin,
    History,
    AlertCircle,
    Trash2,
    RefreshCw
} from 'lucide-react';
import { DeviceInstance, DeviceDetails } from '@/types';
import { BaseModal as Modal } from '@/components/shared/BaseModal';
import clsx from 'clsx';

interface DeviceHistoryModalProps {
    patientName: string;
    history: DeviceInstance[];
    currentDevices: string[];
    deviceDetails: DeviceDetails;
    onSave: (newHistory: DeviceInstance[]) => void;
    onClose: () => void;
}

export const DeviceHistoryModal: React.FC<DeviceHistoryModalProps> = ({
    patientName,
    history = [],
    currentDevices = [],
    deviceDetails = {},
    onSave,
    onClose
}) => {
    // Initialize Local History by Merging Existing History + Current Devices (Backfill)
    const [localHistory, setLocalHistory] = useState<DeviceInstance[]>(() => {
        const merged = [...history];
        const dateStr = new Date().toISOString().split('T')[0];
        const timeStr = '00:00'; // Default time for backfilled items

        // Backfill: If a current device is missing from history (as Active), add it
        currentDevices.forEach(device => {
            const hasActive = merged.some(h => h.type === device && h.status === 'Active');
            if (!hasActive) {
                // Try to find installation date from details
                const detail = deviceDetails[device];
                const installDate = detail?.installationDate || dateStr;

                merged.push({
                    id: crypto.randomUUID(),
                    type: device,
                    status: 'Active',
                    installationDate: installDate,
                    installationTime: timeStr,
                    location: '',
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                });
            }
        });

        return merged.sort((a, b) => {
            if (a.status === 'Active' && b.status !== 'Active') return -1;
            if (a.status !== 'Active' && b.status === 'Active') return 1;
            return new Date(b.installationDate).getTime() - new Date(a.installationDate).getTime();
        });
    });

    const handleDeleteRecord = (id: string) => {
        setLocalHistory(localHistory.filter(item => item.id !== id));
    };





    const handleSaveOnly = () => {
        onSave(localHistory);
    };

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={
                <div className="flex items-center gap-2">
                    <span>Historial de Dispositivos - {patientName}</span>
                    <button
                        onClick={handleSaveOnly}
                        className="p-1 rounded text-slate-300 hover:text-medical-500 hover:bg-medical-50 transition-all"
                        title="Actualizar reflejo"
                    >
                        <RefreshCw size={14} />
                    </button>
                </div>
            }
            size="lg"
            variant="white"
        >
            <div className="flex flex-col min-h-[400px] max-h-[600px]">
                {/* Minimalist Header */}
                <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-100">
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-100 text-slate-500">
                        <History size={12} />
                        <span className="text-[10px] font-medium tracking-wide uppercase">Reflejo de dispositivos instalados</span>
                    </div>

                </div>



                {/* History List */}
                <div className="flex-1 overflow-y-auto pr-1 space-y-1.5 custom-scrollbar">
                    {localHistory.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-300 space-y-2">
                            <AlertCircle size={32} strokeWidth={1.5} />
                            <p className="text-[11px] font-medium italic">Sin registros históricos</p>
                        </div>
                    ) : (
                        localHistory.map((item) => (
                            <div
                                key={item.id}
                                className={clsx(
                                    "border rounded-lg px-3 py-2 transition-all relative group flex flex-col gap-2",
                                    item.status === 'Active'
                                        ? "bg-white border-slate-100 shadow-sm"
                                        : "bg-slate-50/50 border-transparent opacity-60"
                                )}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={clsx(
                                            "w-8 h-8 rounded-md flex items-center justify-center font-bold text-[10px]",
                                            item.status === 'Active' ? "bg-medical-50 text-medical-600" : "bg-slate-200 text-slate-500"
                                        )}>
                                            {item.type.substring(0, 3)}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-slate-700">{item.type}</span>
                                                <span className={clsx(
                                                    "text-[8px] px-1.5 py-0.5 rounded uppercase font-bold tracking-tight",
                                                    item.status === 'Active' ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-slate-100 text-slate-500 border border-slate-200"
                                                )}>
                                                    {item.status === 'Active' ? 'Activo' : 'Cerrado'}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3 mt-0.5">
                                                <span className="flex items-center gap-1 text-[10px] text-slate-400">
                                                    <Calendar size={10} />
                                                    {item.installationDate?.split('-').reverse().join('-')} <span className="opacity-60">{item.installationTime}</span>
                                                </span>
                                                {item.location && (
                                                    <span className="flex items-center gap-1 text-[10px] text-slate-400">
                                                        <MapPin size={10} />
                                                        {item.location}
                                                    </span>
                                                )}
                                                {item.status === 'Removed' && (
                                                    <span className="text-[10px] text-orange-400 font-medium">
                                                        Retiro: {item.removalDate?.split('-').reverse().join('-')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Delete Button */}
                                    <button
                                        onClick={() => handleDeleteRecord(item.id)}
                                        className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                                        title="Eliminar registro"
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Minimalist Footer */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
                    <button onClick={onClose} className="text-[11px] font-bold text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-wider">Cerrar</button>
                </div>
            </div>
        </Modal>
    );
};
