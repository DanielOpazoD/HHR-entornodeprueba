import React from 'react';
import clsx from 'clsx';
import { calculateDeviceDays } from './DeviceDateConfigModal';
import { DeviceDetails } from '../../types';
import { formatDateDDMMYYYY } from '../../services/dataService';

interface DeviceBadgeProps {
    device: string;
    deviceDetails?: DeviceDetails;
    currentDate?: string;
}

export const DeviceBadge: React.FC<DeviceBadgeProps> = React.memo(({
    device,
    deviceDetails = {},
    currentDate
}) => {
    let badgeText = device;
    if (device === '2 VVP') badgeText = '2VVP';

    // Get details for ANY device (no longer limited to TRACKED_DEVICES)
    const details = deviceDetails[device];
    const days = details?.installationDate ? calculateDeviceDays(details.installationDate, currentDate) : null;

    // Alert colors based on days (IAAS thresholds for known devices)
    const isAlert = days !== null && (
        (device === 'CUP' && days >= 5) ||
        (device === 'CVC' && days >= 7) ||
        (device === 'VMI' && days >= 5) ||
        (device.startsWith('VVP') && days >= 4)
    );

    // Format tooltip text
    const tooltipText = details?.installationDate
        ? `FI: ${formatDateDDMMYYYY(details.installationDate)}${details.removalDate ? ` | FR: ${formatDateDDMMYYYY(details.removalDate)}` : ''}`
        : null;

    return (
        <span className="relative group inline-flex">
            <span
                className={clsx(
                    "text-[9px] px-1 py-0.5 rounded border font-medium whitespace-nowrap flex items-center gap-0.5",
                    isAlert
                        ? "bg-orange-100 text-orange-700 border-orange-200"
                        : "bg-medical-50 text-medical-700 border-medical-100"
                )}
            >
                {badgeText}
                {days !== null && (
                    <span className="text-[8px] opacity-70 ml-0.5">({days}d)</span>
                )}
            </span>

            {/* Tooltip with installation date - shows for ALL devices with date */}
            {tooltipText && (
                <span className="invisible group-hover:visible absolute left-1/2 -translate-x-1/2 top-full mt-1 bg-slate-900 text-white text-[10px] px-2 py-1 rounded shadow-lg whitespace-nowrap z-20 pointer-events-none">
                    {tooltipText}
                </span>
            )}
        </span>
    );
});

DeviceBadge.displayName = 'DeviceBadge';
