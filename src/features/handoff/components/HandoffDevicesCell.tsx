import type { PatientData } from '@/types/domain/patient';

import React from 'react';

import { calculateDeviceDays } from '@/components/device-selector/DeviceDateConfigModal';
import { MedicalBadge } from '@/components/ui/base/MedicalBadge';

interface HandoffDevicesCellProps {
  patient: PatientData;
  reportDate: string;
}

export const HandoffDevicesCell: React.FC<HandoffDevicesCellProps> = ({ patient, reportDate }) => (
  <td className="p-2 border-r border-slate-200/60 w-28 text-xs align-middle print:w-auto print:text-[9px] print:p-1">
    <div className="flex flex-wrap gap-1">
      {patient.devices.length > 0 ? (
        patient.devices.map(d => {
          let deviceDays: number | null = null;
          const details = patient.deviceDetails;
          if (details) {
            const deviceKey = d as keyof typeof details;
            const deviceInfo = details[deviceKey];
            if (deviceInfo?.installationDate) {
              deviceDays = calculateDeviceDays(deviceInfo.installationDate, reportDate);
            }
          }
          return (
            <MedicalBadge key={d} variant="slate" pill={false}>
              {d}
              {deviceDays !== null && deviceDays > 0 && (
                <span className="font-bold ml-0.5">({deviceDays}d)</span>
              )}
            </MedicalBadge>
          );
        })
      ) : (
        <span className="text-slate-400 print:text-[9px]">-</span>
      )}
    </div>
  </td>
);
