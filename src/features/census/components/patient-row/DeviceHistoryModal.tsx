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
    Trash2
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

    const handleUpdateRecord = (id: string, updates: Partial<DeviceInstance>) => {
        setLocalHistory(localHistory.map(item =>
            item.id === id ? { ...item, ...updates, updatedAt: Date.now() } : item
        ));
    };

    const handleSave = () => {
        onSave(localHistory);
        onClose();
    };

    return (
        <Modal
            isOpen={true}
            onClose={onClose}
            title={`Historial de Dispositivos - ${patientName}`}
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
                <div className="flex-1 overflow-y-auto pr-1 space-y-2 custom-scrollbar">
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
                                        : "bg-slate-50/50 border-transparent opacity-80"
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
                                            <div className="flex items-center gap-3 mt-1.5">
                                                {/* Edit Installation Date */}
                                                <div className="flex items-center gap-1 group/date">
                                                    <Calendar size={10} className="text-slate-400" />
                                                    <input
                                                        type="date"
                                                        value={item.installationDate}
                                                        onChange={(e) => handleUpdateRecord(item.id, { installationDate: e.target.value })}
                                                        className="text-[10px] bg-transparent border-none p-0 focus:ring-0 text-slate-500 hover:text-medical-600 cursor-pointer"
                                                    />
                                                </div>

                                                {/* Edit Location/Note */}
                                                <div className="flex items-center gap-1">
                                                    <MapPin size={10} className="text-slate-400" />
                                                    <input
                                                        type="text"
                                                        value={item.location || ''}
                                                        onChange={(e) => handleUpdateRecord(item.id, { location: e.target.value })}
                                                        placeholder="Ubicación..."
                                                        className="text-[10px] bg-transparent border-none p-0 focus:ring-0 text-slate-500 hover:text-medical-600 w-24"
                                                    />
                                                </div>

                                                {/* Edit Removal Date if closed */}
                                                {item.status === 'Removed' && (
                                                    <div className="flex items-center gap-1 ml-2 border-l pl-2 border-orange-100">
                                                        <span className="text-[10px] text-orange-400 font-medium">Fin:</span>
                                                        <input
                                                            type="date"
                                                            value={item.removalDate}
                                                            onChange={(e) => handleUpdateRecord(item.id, { removalDate: e.target.value })}
                                                            className="text-[10px] bg-transparent border-none p-0 focus:ring-0 text-orange-500 hover:text-orange-600 cursor-pointer font-medium"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Delete Button */}
                                    <button
                                        onClick={() => handleDeleteRecord(item.id)}
                                        className="p-1 px-2 rounded-md transition-all opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 hover:bg-red-50"
                                        title="Eliminar registro permanentemente"
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer with Guardar/Cancelar */}
                <div className="mt-6 pt-3 border-t border-slate-100 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-[11px] font-bold text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-wider"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-6 py-2 bg-medical-600 text-white rounded-lg text-[11px] font-bold hover:bg-medical-700 transition-all shadow-md shadow-medical-500/10 uppercase tracking-wider"
                    >
                        Guardar Cambios
                    </button>
                </div>
            </div>
        </Modal>
    );
};
