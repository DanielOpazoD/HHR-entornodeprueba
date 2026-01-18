/**
 * DevicesCell - Devices display and management cell
 */

import React, { useMemo } from 'react';
import { DeviceSelector } from '../../DeviceSelector';
import { DeviceDetails } from '../../../types';
import { BaseCellProps } from './inputCellTypes';

interface DevicesCellProps extends BaseCellProps {
    currentDateString: string;
    onDevicesChange: (devices: string[]) => void;
    onDeviceDetailsChange: (details: DeviceDetails) => void;
}

export const DevicesCell: React.FC<DevicesCellProps> = ({
    data,
    isSubRow = false,
    isEmpty = false,
    readOnly = false,
    currentDateString,
    onDevicesChange,
    onDeviceDetailsChange
}) => {
    // Memoize to prevent unnecessary re-renders
    const memoizedDevices = useMemo(() => data.devices || [], [data.devices]);
    const memoizedDeviceDetails = useMemo(() => data.deviceDetails || {}, [data.deviceDetails]);

    if (isEmpty && !isSubRow) {
        return (
            <td className="py-0.5 px-1 border-r border-slate-200 w-32 relative">
                <div className="w-full py-0.5 px-1 border border-slate-200 rounded bg-slate-100 text-slate-400 text-xs italic text-center">
                    -
                </div>
            </td>
        );
    }

    return (
        <td className="py-0.5 px-1 border-r border-slate-200 w-32 relative">
            <DeviceSelector
                devices={memoizedDevices}
                deviceDetails={memoizedDeviceDetails}
                onChange={onDevicesChange}
                onDetailsChange={onDeviceDetailsChange}
                currentDate={currentDateString}
                disabled={readOnly || false}
            />
        </td>
    );
};
