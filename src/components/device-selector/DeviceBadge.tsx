import React from 'react';
import { calculateDeviceDays } from './DeviceDateConfigModal';
import { DeviceDetails } from '@/types';
import { formatDateDDMMYYYY } from '@/services/dataService';

import { MedicalBadge } from '@/components/ui/base/MedicalBadge';


interface DeviceBadgeProps {
    device: string;
    deviceDetails?: DeviceDetails;
    currentDate?: string;
    onRemove?: (device: string) => void;
}

export const DeviceBadge: React.FC<DeviceBadgeProps> = React.memo(({
    device,
    deviceDetails = {},
    currentDate,
    onRemove: _onRemove
}) => {
    let badgeText = device;
    if (device.startsWith('VVP#')) {
        const num = device.split('#')[1];
        badgeText = num === '1' ? 'VVP' : `VVP#${num}`;
    }

    // Get details for ANY device
    const details = deviceDetails[device];
    const days = details?.installationDate ? calculateDeviceDays(details.installationDate, currentDate) : null;

    // Alert colors based on days
    const isAlert = days !== null && (
        (device === 'CUP' && days >= 5) ||
        (device === 'CVC' && days >= 7) ||
        (device === 'TET' && days >= 5) ||
        (device.startsWith('VVP') && days >= 4)
    );

    // Format tooltip text
    const tooltipText = details?.installationDate
        ? `FI: ${formatDateDDMMYYYY(details.installationDate)}`
        : null;

    return (
        <span className="relative group/badge inline-flex">
            <MedicalBadge
                variant={isAlert ? 'orange' : 'blue'}
                className="whitespace-nowrap flex items-center gap-0.5 px-0.5"
                pill={false}
            >
                {badgeText}
                {days !== null && (
                    <span className="text-[9px] opacity-70 ml-0.5">({days}d)</span>
                )}
            </MedicalBadge>

            {/* Tooltip */}
            {tooltipText && (
                <span className="invisible group-hover/badge:visible absolute left-1/2 -translate-x-1/2 top-full mt-1 bg-slate-900 text-white text-[10px] px-2 py-1 rounded shadow-lg whitespace-nowrap z-20 pointer-events-none">
                    {tooltipText}
                </span>
            )}
        </span>
    );
});

DeviceBadge.displayName = 'DeviceBadge';
