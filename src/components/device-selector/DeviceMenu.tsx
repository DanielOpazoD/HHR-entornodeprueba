/**
 * DeviceMenu Component
 * Dropdown menu for selecting and managing devices.
 * Extracted from DeviceSelector for better component organization.
 */

import React, { useState } from 'react';
import clsx from 'clsx';
import { Plus, X, Check, Settings } from 'lucide-react';
import { DeviceDetails } from '@/types';
import { DEVICE_OPTIONS } from '@/constants';
interface DeviceMenuProps {
    devices: string[];
    deviceDetails: DeviceDetails;
    vvpCount: number;
    vvpDevices: string[];
    menuPosition: { top: number; left: number; placement?: 'top' | 'bottom' };
    onClose: () => void;
    onToggleDevice: (device: string) => void;
    onAddCustomDevice: (device: string) => void;
    onRemoveDevice: (device: string) => void;
    onConfigureDevice: (device: string) => void; // Now accepts any device
}

// Helper to check if device is any VVP variant
const isAnyVvp = (device: string) => device === 'VVP' || device === '2 VVP' || device.startsWith('VVP#');

// Helper to check if device is tracked


export const DeviceMenu: React.FC<DeviceMenuProps> = ({
    devices,
    deviceDetails,
    vvpCount,
    vvpDevices,
    menuPosition,
    onClose,
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
                className={clsx(
                    "fixed z-50 w-[360px] bg-white rounded-lg shadow-xl border border-slate-200 animate-scale-in text-left",
                    menuPosition.placement === 'top' ? "origin-bottom" : "origin-top"
                )}
                style={{
                    top: menuPosition.placement === 'top' ? 'auto' : `${menuPosition.top}px`,
                    bottom: menuPosition.placement === 'top' ? `${window.innerHeight - menuPosition.top}px` : 'auto',
                    left: `${menuPosition.left}px`
                }}
            >
                {/* Header */}
                <div className="p-2.5 bg-slate-50 border-b border-slate-100 flex justify-between items-center rounded-t-lg">
                    <span className="text-[10px] font-bold text-slate-700 uppercase">Dispositivos</span>
                    <button
                        onClick={(e) => { e.stopPropagation(); onClose(); }}
                        className="text-slate-400 hover:text-slate-600"
                    >
                        <X size={14} />
                    </button>
                </div>

                <div className="p-2.5">
                    {/* Active VVPs List */}
                    <div className="mb-3 space-y-1.5">
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Vías Venosas (VVP)</span>
                            {vvpCount < 3 && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onToggleDevice('VVP'); }}
                                    className="flex items-center gap-1 px-2 py-1 rounded-full bg-medical-50 text-medical-700 border border-medical-200 text-[11px] font-bold hover:bg-medical-100 transition-colors shadow-sm"
                                >
                                    <Plus size={11} /> Añadir
                                </button>
                            )}
                        </div>

                        {vvpDevices.length > 0 ? (
                            <div className="grid grid-cols-1 gap-1">
                                {vvpDevices.map((vvp, idx) => {
                                    const details = deviceDetails[vvp];
                                    const hasConfig = details?.installationDate;
                                    return (
                                        <div key={vvp} className="flex items-center gap-2 p-1.5 rounded-md bg-medical-50/50 border border-medical-100/50">
                                            <div className="w-5 h-5 rounded-full bg-medical-600 text-white flex items-center justify-center text-[10px] font-bold shadow-sm">
                                                {idx + 1}
                                            </div>
                                            <span className="flex-1 text-[11px] font-bold text-medical-800">VVP #{idx + 1}</span>

                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onConfigureDevice(vvp); }}
                                                    className={clsx(
                                                        "p-1 rounded hover:bg-white transition-colors",
                                                        hasConfig ? "text-medical-600" : "text-slate-400 hover:text-medical-500"
                                                    )}
                                                    title="Configurar fechas"
                                                >
                                                    <Settings size={12} />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onRemoveDevice(vvp); }}
                                                    className="p-1 rounded hover:bg-white text-slate-400 hover:text-red-500 transition-colors"
                                                    title="Eliminar"
                                                >
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="text-[11px] text-slate-400 italic py-1 pl-1">Sin vías activas</div>
                        )}
                    </div>

                    <div className="mb-2">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Otros Dispositivos</span>
                        {/* Unified Devices Grid - Now 3 Columns and Compact */}
                        <div className="grid grid-cols-3 gap-1.5">
                            {[...DEVICE_OPTIONS, ...customDevices].map(dev => {
                                const isSelected = devices.includes(dev);
                                const details = deviceDetails[dev];
                                const hasConfig = details?.installationDate;

                                return (
                                    <div key={dev} className="relative">
                                        <div
                                            className={clsx(
                                                "w-full flex items-center justify-between gap-1 px-1.5 py-1.5 rounded-md border text-[11px] text-left transition-all cursor-pointer select-none min-h-[36px]",
                                                isSelected
                                                    ? "bg-slate-50 border-slate-300 text-slate-800 shadow-sm"
                                                    : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                                            )}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onToggleDevice(dev);
                                            }}
                                        >
                                            <div className="flex items-center gap-1.5 min-w-0 pr-0.5">
                                                <div className={clsx(
                                                    "w-3 h-3 rounded-sm border flex items-center justify-center flex-shrink-0 transition-colors",
                                                    isSelected ? "bg-slate-700 border-slate-700" : "border-slate-300"
                                                )}>
                                                    {isSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                                                </div>
                                                <span className="font-bold truncate leading-tight">{dev}</span>
                                            </div>

                                            {isSelected && (
                                                <div className="flex items-center flex-shrink-0 gap-0.5">
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onConfigureDevice(dev);
                                                        }}
                                                        className={clsx(
                                                            "p-0.5 rounded hover:bg-white transition-colors",
                                                            hasConfig ? "text-medical-600" : "text-slate-400 hover:text-medical-500"
                                                        )}
                                                        title="Configurar"
                                                    >
                                                        <Settings size={10} />
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            onRemoveDevice(dev);
                                                        }}
                                                        className="p-0.5 rounded hover:bg-white text-slate-400 hover:text-red-500 transition-colors"
                                                        title="Retirar"
                                                    >
                                                        <X size={10} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Custom Device Input */}
                    <div className="pt-3 border-t border-slate-100">
                        <div className="flex gap-2 items-center">
                            <div className="flex-1 relative">
                                <input
                                    type="text"
                                    value={customDevice}
                                    onChange={(e) => setCustomDevice(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
                                    className="w-full text-[11px] py-1.5 pl-2 pr-8 border border-slate-200 rounded-md focus:ring-2 focus:ring-medical-500/20 focus:border-medical-500 focus:outline-none transition-all"
                                    placeholder="Otro dispositivo..."
                                />
                                {customDevice.trim() && (
                                    <button
                                        onClick={handleAddCustom}
                                        className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-medical-600 hover:bg-medical-50 rounded"
                                    >
                                        <Plus size={14} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Backdrop */}
            <div className="fixed inset-0 z-40" onClick={onClose}></div>
        </>
    );
};
