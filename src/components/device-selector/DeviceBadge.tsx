import React from 'react';
import { calculateDeviceDays } from './DeviceDateConfigModal';
import type { DeviceDetails } from '@/types/domain/devices';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';

import { MedicalBadge } from '@/components/ui/base/MedicalBadge';

interface DeviceBadgeProps {
  device: string;
  deviceDetails?: DeviceDetails;
  currentDate?: string;
  onRemove?: (device: string) => void;
}

export const DeviceBadge: React.FC<DeviceBadgeProps> = React.memo(
  ({ device, deviceDetails = {}, currentDate, onRemove: _onRemove }) => {
    let badgeText = device;
    if (device.startsWith('VVP#')) {
      const num = device.split('#')[1];
      badgeText = num === '1' ? 'VVP' : `VVP#${num}`;
    }

    // Get details for ANY device
    const details = deviceDetails[device];
    const days = details?.installationDate
      ? calculateDeviceDays(details.installationDate, currentDate)
      : null;

    // Format tooltip text
    const tooltipText = details?.installationDate
      ? `FI: ${formatDateDDMMYYYY(details.installationDate)}`
      : null;

    return (
      <span className="inline-flex" title={tooltipText ?? undefined}>
        <MedicalBadge
          variant="blue"
          className="whitespace-nowrap flex items-center gap-0.5 px-0.5 bg-sky-100 border-sky-200 text-black print:bg-transparent print:text-black"
          pill={false}
        >
          {badgeText}
          {days !== null && <span className="text-[9px] opacity-70 ml-0.5">({days}d)</span>}
        </MedicalBadge>
      </span>
    );
  }
);

DeviceBadge.displayName = 'DeviceBadge';
