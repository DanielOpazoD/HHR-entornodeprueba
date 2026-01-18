/**
 * DeviceMenu Component
 * Dropdown menu for selecting and managing devices.
 * Extracted from DeviceSelector for better component organization.
 */

import React, { useState } from 'react';
import clsx from 'clsx';
import { Plus, X, Check, Settings } from 'lucide-react';
import { DeviceDetails } from '../../types';
import { DEVICE_OPTIONS } from '../../constants';
import { VVPSelector } from './VVPSelector';
import { TRACKED_DEVICES, TrackedDevice } from './index';

interface DeviceMenuProps {
    devices: string[];
    deviceDetails: DeviceDetails;
    vvpCount: number;
    vvpDevices: string[];
    menuPosition: { top: number; left: number };
    onClose: () => void;
    onSetVVPCount: (count: number) => void;
    onToggleDevice: (device: string) => void;
    onAddCustomDevice: (device: string) => void;
    onRemoveDevice: (device: string) => void;
    onConfigureDevice: (device: string) => void; // Now accepts any device
}

// Helper to check if device is any VVP variant
const isAnyVvp = (device: string) => device === 'VVP' || device === '2 VVP' || device.startsWith('VVP#');

// Helper to check if device is tracked
const isTrackedDevice = (dev: string): dev is TrackedDevice =>
    TRACKED_DEVICES.includes(dev as TrackedDevice);

export const DeviceMenu: React.FC<DeviceMenuProps> = ({
    devices,
    deviceDetails,
    vvpCount,
    vvpDevices,
    menuPosition,
    onClose,
    onSetVVPCount,
    onToggleDevice,
    onAddCustomDevice,
    onRemoveDevice,
    onConfigureDevice
}) => {
    const [customDevice, setCustomDevice] = useState('');

    const handleAddCustom = () => {
        if (customDevice.trim()) {
            onAddCustomDevice(customDevice.trim());
            setCustomDevice('');
        }
    };

    const customDevices = devices.filter(d => !DEVICE_OPTIONS.includes(d) && !isAnyVvp(d));

    return (
        <>
            <div
                className="fixed z-50 w-64 bg-white rounded-lg shadow-xl border border-slate-200 animate-scale-in text-left"
                style={{ top: `${menuPosition.top}px`, left: `${menuPosition.left}px` }}
            >
                {/* Header */}
                <div className="p-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center rounded-t-lg">
                    <span className="text-xs font-bold text-slate-700 uppercase">Dispositivos</span>
                    <button
                        onClick={(e) => { e.stopPropagation(); onClose(); }}
                        className="text-slate-400 hover:text-slate-600"
                    >
                        <X size={14} />
                    </button>
                </div>

                <div className="p-3">
                    {/* VVP Section */}
                    <VVPSelector
                        vvpCount={vvpCount}
                        vvpDevices={vvpDevices}
                        deviceDetails={deviceDetails}
                        onSetVVPCount={onSetVVPCount}
                        onConfigureVVP={onConfigureDevice}
                    />

                    {/* Other Devices Grid */}
                    <div className="grid grid-cols-2 gap-2 mb-3">
                        {DEVICE_OPTIONS.map(dev => {
                            const isSelected = devices.includes(dev);
                            const details = deviceDetails[dev];
                            const hasConfig = details?.installationDate;

                            return (
                                <div key={dev} className="relative">
                                    <div
                                        className={clsx(
                                            "w-full flex items-center gap-2 px-2 py-1.5 rounded border text-xs text-left transition-colors cursor-pointer select-none",
                                            isSelected
                                                ? "bg-medical-50 border-medical-200 text-medical-800"
                                                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                        )}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            e.preventDefault();
                                            onToggleDevice(dev);
                                        }}
                                    >
                                        <div className={clsx(
                                            "w-3 h-3 rounded-sm border flex items-center justify-center flex-shrink-0",
                                            isSelected ? "bg-medical-600 border-medical-600" : "border-slate-300"
                                        )}>
                                            {isSelected && <Check size={10} className="text-white" />}
                                        </div>
                                        <span className="flex-1 truncate">{dev}</span>

                                        {/* Config icon for ALL selected devices */}
                                        {isSelected && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onConfigureDevice(dev);
                                                }}
                                                className={clsx(
                                                    "p-0.5 rounded hover:bg-medical-100 transition-colors",
                                                    hasConfig ? "text-medical-600" : "text-slate-400"
                                                )}
                                                title="Configurar fechas"
                                            >
                                                <Settings size={12} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Custom Device Input */}
                    <div className="pt-2 border-t border-slate-100">
                        <label className="text-xs font-semibold text-slate-600 mb-2 block">
                            Otro Dispositivo
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={customDevice}
                                onChange={(e) => setCustomDevice(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
                                className="flex-1 text-xs p-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-medical-500 focus:outline-none"
                                placeholder="Escribir..."
                            />
                            <button
                                onClick={handleAddCustom}
                                disabled={!customDevice.trim()}
                                className="p-1.5 bg-medical-500 text-white rounded hover:bg-medical-600 disabled:opacity-50"
                            >
                                <Plus size={14} />
                            </button>
                        </div>

                        {/* Custom Devices List */}
                        {customDevices.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1">
                                {customDevices.map(dev => {
                                    const details = deviceDetails[dev];
                                    const hasConfig = details?.installationDate;

                                    return (
                                        <span
                                            key={dev}
                                            className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 font-medium flex items-center gap-1"
                                        >
                                            {dev}
                                            <button
                                                onClick={() => onConfigureDevice(dev)}
                                                className={clsx(
                                                    "hover:bg-amber-100 rounded transition-colors",
                                                    hasConfig ? "text-amber-600" : "text-amber-400"
                                                )}
                                                title="Configurar fechas"
                                            >
                                                <Settings size={10} />
                                            </button>
                                            <button
                                                onClick={() => onRemoveDevice(dev)}
                                                className="text-amber-500 hover:text-red-500"
                                                title="Eliminar dispositivo"
                                            >
                                                <X size={10} />
                                            </button>
                                        </span>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Backdrop */}
            <div className="fixed inset-0 z-40" onClick={onClose}></div>
        </>
    );
};
