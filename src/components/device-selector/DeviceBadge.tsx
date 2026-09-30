import React from 'react';
import { calculateDeviceDays } from './DeviceDateConfigModal';
import type { DeviceDetails } from '@/types/domain/devices';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { isNasogastricDevice } from '@/constants/clinicalDeviceConstants';

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
    if (isNasogastricDevice(device)) badgeText = 'SNG';

    // Get details for ANY device
    const details = deviceDetails[device];
    const days = details?.installationDate
      ? calculateDeviceDays(details.installationDate, currentDate)
      : null;

    // Format tooltip text
    const fullDeviceName = isNasogastricDevice(device) ? 'Sonda nasogástrica' : device;
    const tooltipText = `${fullDeviceName} · ${days !== null ? `${days} días` : 'antigüedad sin registrar'}${
      details?.installationDate ? ` · FI: ${formatDateDDMMYYYY(details.installationDate)}` : ''
    }`;

    return (
      <span
        className="inline-flex max-w-full rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-sky-600"
        title={tooltipText}
        aria-label={tooltipText}
        tabIndex={0}
      >
        <MedicalBadge
          variant="blue"
          className="flex max-w-full items-center gap-0.5 whitespace-nowrap border-sky-200 bg-sky-100 px-1 py-0.5 text-[10px] leading-tight text-black print:bg-transparent print:text-black"
          pill={false}
        >
          {badgeText}
          {days !== null && <span className="text-[9px] opacity-70">({days}d)</span>}
        </MedicalBadge>
      </span>
    );
  }
);

DeviceBadge.displayName = 'DeviceBadge';
