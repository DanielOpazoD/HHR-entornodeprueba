/**
 * VVPSelector Component
 * Handles VVP (Vía Venosa Periférica) count selection with 0-3 buttons.
 * Extracted from DeviceSelector for better component organization.
 */

import React from 'react';
import clsx from 'clsx';
import { Settings } from 'lucide-react';
import { DeviceDetails } from '../../types';

import { TrackedDevice } from './index';

interface VVPSelectorProps {
    vvpCount: number;
    vvpDevices: string[];
    deviceDetails: DeviceDetails;
    onSetVVPCount: (count: number) => void;
    onConfigureVVP: (device: TrackedDevice) => void;
}

export const VVPSelector: React.FC<VVPSelectorProps> = ({
    vvpCount,
    vvpDevices,
    deviceDetails,
    onSetVVPCount,
    onConfigureVVP
}) => {
    return (
        <div className="mb-3 pb-3 border-b border-slate-100">
            <label className="text-xs font-semibold text-slate-600 mb-2 block">
                Vías Venosas (VVP)
            </label>
            <div className="flex gap-2">
                <button
                    onClick={() => onSetVVPCount(0)}
                    className={clsx(
                        "flex-1 py-1 text-xs rounded border transition-colors",
                        vvpCount === 0
                            ? "bg-slate-200 text-slate-600 border-slate-300 shadow-inner"
                            : "hover:bg-slate-50 text-slate-500"
                    )}
                >
                    Ninguna
                </button>
                <button
                    onClick={() => onSetVVPCount(1)}
                    className={clsx(
                        "flex-1 py-1 text-xs rounded border transition-colors",
                        vvpCount === 1
                            ? "bg-medical-600 text-white border-medical-700 shadow-sm"
                            : "hover:bg-medical-50 text-medical-600 border-medical-200"
                    )}
                >
                    1
                </button>
                <button
                    onClick={() => onSetVVPCount(2)}
                    className={clsx(
                        "flex-1 py-1 text-xs rounded border transition-colors",
                        vvpCount === 2
                            ? "bg-purple-600 text-white border-purple-700 shadow-sm"
                            : "hover:bg-purple-50 text-purple-600 border-purple-200"
                    )}
                >
                    2
                </button>
                <button
                    onClick={() => onSetVVPCount(3)}
                    className={clsx(
                        "flex-1 py-1 text-xs rounded border transition-colors",
                        vvpCount === 3
                            ? "bg-indigo-600 text-white border-indigo-700 shadow-sm"
                            : "hover:bg-indigo-50 text-indigo-600 border-indigo-200"
                    )}
                >
                    3
                </button>
            </div>

            {/* VVP Config Buttons */}
            {vvpDevices.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                    {vvpDevices.map(vvp => {
                        const hasConfig = deviceDetails?.[vvp as keyof DeviceDetails]?.installationDate;
                        return (
                            <button
                                key={vvp}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onConfigureVVP(vvp as TrackedDevice);
                                }}
                                className={clsx(
                                    "px-2 py-1 text-[11px] rounded border flex items-center gap-1 transition-colors",
                                    hasConfig
                                        ? "bg-medical-50 border-medical-200 text-medical-700"
                                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                                )}
                                title={`Configurar ${vvp}`}
                            >
                                <Settings size={12} />
                                {vvp}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
