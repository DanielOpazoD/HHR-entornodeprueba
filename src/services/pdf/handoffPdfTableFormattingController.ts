import type { PatientData } from '@/types/domain/patient';

import type { ShiftType } from '@/types/domain/shift';
import type { DeviceDetails } from '@/types/domain/devices';

import { calculateHospitalizedDays } from './handoffPdfUtils';

export const formatPatientDevicesForPdf = (patient: PatientData, recordDate: string): string => {
  if (!patient.devices || !Array.isArray(patient.devices) || patient.devices.length === 0) {
    return '';
  }

  return patient.devices
    .map((device: string) => {
      const detail = patient.deviceDetails?.[device as keyof DeviceDetails];
      let daysStr = '';
      if (detail?.installationDate) {
        const diffDays = calculateHospitalizedDays(detail.installationDate, recordDate);
        if (diffDays && diffDays > 0) daysStr = ` (${diffDays}d)`;
      }
      return `${device}${daysStr}`;
    })
    .join(', ');
};

export const resolvePatientObservationForPdf = (
  patient: PatientData,
  isMedical: boolean,
  selectedShift: ShiftType
): string => {
  if (isMedical) {
    return patient.medicalHandoffNote || '';
  }

  return selectedShift === 'day'
    ? patient.handoffNoteDayShift || ''
    : patient.handoffNoteNightShift || '';
};

export const resolveStatusTextStyles = (status: string): Record<string, unknown> | null => {
  const normalizedStatus = status.toLowerCase();
  if (normalizedStatus === 'grave') {
    return { textColor: [185, 28, 28], fontStyle: 'bold' };
  }
  if (normalizedStatus === 'de cuidado') {
    return { textColor: [194, 65, 12] };
  }
  if (normalizedStatus === 'estable') {
    return { textColor: [21, 128, 61] };
  }
  return null;
};
