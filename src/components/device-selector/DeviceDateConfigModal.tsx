import React from 'react';
import { Calendar, Clock } from 'lucide-react';
import { DeviceInfo } from '@/types';
import { VVP_DEVICE_KEYS } from '@/constants';
import { BaseModal } from '@/components/shared/BaseModal';

// Legacy tracked devices list (kept for backward compatibility)
export const TRACKED_DEVICES = ['CUP', 'CVC', 'VMI', ...VVP_DEVICE_KEYS] as const;
export type TrackedDevice = typeof TRACKED_DEVICES[number];

// Labels for known devices
export const DEVICE_LABELS: Record<string, string> = {
    'CUP': 'Sonda Foley',
    'CVC': 'Catéter Venoso Central',
    'TET': 'Tubo Orotraqueal',
    'VVP#1': 'Vía Venosa Periférica #1',
    'VVP#2': 'Vía Venosa Periférica #2',
    'VVP#3': 'Vía Venosa Periférica #3',
    'SNG': 'Sonda Nasogástrica',
    'SNY': 'Sonda Nasoyeyunal',
    'TOT': 'Tubo Orotraqueal',
    'FO': 'Fijador Ortopédico',
    'Drenaje': 'Drenaje Quirúrgico',
    'CVO': 'Catéter Venoso Onfalico',
    'DAV': 'Dispositivo Acceso Venoso',
    'NEF': 'Nefrostomía',
    'DVE': 'Drenaje Ventricular Externo',
    'VAP': 'Ventilación Asistida Proporcional',
    'LQ': 'Línea Química',
    'SV': 'Sonda Vesical',
    'VA': 'Vía Aérea',
    'DB': 'Dispositivo Biliar',
    'WE': 'Wound VAC / Presión Negativa',
    'PICC': 'Catéter Central de Inserción Periférica',
    'TQ': 'Traqueostomía',
    'VB': 'Vía Biliar'
};

/**
 * Get display label for a device
 * Returns known label or the device name itself for custom devices
 */
const getDeviceLabel = (device: string): string => {
    return DEVICE_LABELS[device] || device;
};

/**
 * Calculate days since installation
 * Inclusion: The installation day counts as Day 1.
 */
export const calculateDeviceDays = (installDate?: string, currentDate?: string): number | null => {
    if (!installDate || !currentDate) return null;
    const start = new Date(installDate);
    const end = new Date(currentDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    const diff = end.getTime() - start.getTime();
    const days = Math.floor(diff / (1000 * 3600 * 24));
    // The first day (installation) counts as Day 1
    const totalDays = days + 1;
    return totalDays >= 1 ? totalDays : 1;
};

interface DeviceDateConfigModalProps {
    device: string; // Any device name (predefined or custom)
    deviceInfo: DeviceInfo;
    currentDate?: string;
    onSave: (info: DeviceInfo) => void;
    onClose: () => void;
}

export const DeviceDateConfigModal: React.FC<DeviceDateConfigModalProps> = ({
    device,
    deviceInfo,
    currentDate,
    onSave,
    onClose
}) => {
    const [tempDetails, setTempDetails] = React.useState<DeviceInfo>(() => {
        // Default to currentDate (today) for new installations
        if (!deviceInfo.installationDate && currentDate) {
            return { ...deviceInfo, installationDate: currentDate };
        }
        return deviceInfo;
    });
    const deviceLabel = getDeviceLabel(device);
    const isTET = device === 'TET';

    const handleSave = () => {
        onSave(tempDetails);
        onClose();
    };

    return (
        <BaseModal
            isOpen={true}
            onClose={onClose}
            title={`${device} - ${deviceLabel}`}
            icon={<Calendar size={18} />}
            size="sm"
            variant="white"
            headerIconColor="text-medical-600"
        >
            <div className="space-y-4">
                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">
                        {isTET ? 'Fecha de Inicio' : 'Fecha de Instalación'}
                    </label>
                    <input
                        type="date"
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-medical-500 focus:outline-none transition-all shadow-sm"
                        value={tempDetails.installationDate || ''}
                        max={currentDate}
                        onChange={(e) => setTempDetails({ ...tempDetails, installationDate: e.target.value })}
                    />
                </div>


                <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1.5 tracking-wider">
                        Nota <span className="font-normal text-slate-400">(opcional)</span>
                    </label>
                    <textarea
                        className="w-full p-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-medical-500 focus:outline-none resize-none min-h-[70px] transition-all shadow-sm"
                        value={tempDetails.note || ''}
                        onChange={(e) => setTempDetails({ ...tempDetails, note: e.target.value })}
                        placeholder="Registrar detalles relevantes..."
                    />
                </div>

                {/* Days counter */}
                {tempDetails.installationDate && (
                    <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100 mt-2">
                        <Clock size={16} className="text-medical-600" />
                        <span className="text-sm text-slate-600 font-medium">
                            Días con dispositivo: <span className="text-medical-700 font-bold">{calculateDeviceDays(tempDetails.installationDate, currentDate)}</span>
                        </span>
                    </div>
                )}

                <div className="flex justify-end gap-2 pt-4">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-xl text-sm font-medium transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!tempDetails.installationDate}
                        className="px-6 py-2 bg-medical-600 text-white rounded-xl text-sm font-bold hover:bg-medical-700 transition-all shadow-lg shadow-medical-600/20 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
                    >
                        Confirmar e Instalar
                    </button>
                </div>
            </div>
        </BaseModal>
    );
};
