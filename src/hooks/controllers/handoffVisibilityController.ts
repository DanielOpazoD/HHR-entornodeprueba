import type { DailyRecordBedLayoutState } from '@/types/domain/dailyRecordSlices';
import type { DailyRecordDateRef as DailyRecordVisibilityDateRef } from '@/types/domain/dailyRecordSlices';

interface BedDescriptor {
  id: string;
  isExtra?: boolean;
}

export const getVisibleHandoffBeds = <TBed extends BedDescriptor>(
  record: DailyRecordBedLayoutState | null,
  beds: TBed[]
): TBed[] => {
  if (!record) return [];

  const activeExtras = record.activeExtraBeds || [];
  return beds.filter(bed => !bed.isExtra || activeExtras.includes(bed.id));
};

export const shouldShowHandoffPatient = (
  record: (DailyRecordVisibilityDateRef & DailyRecordBedLayoutState) | null,
  bedId: string,
  selectedShift: 'day' | 'night',
  isAdmittedDuringShift: (
    recordDate: string,
    admissionDate: string,
    admissionTime: string | undefined,
    shift: 'day' | 'night'
  ) => boolean
): boolean => {
  if (!record) return false;

  const patient = record.beds[bedId];
  if (!patient) return false;
  if (patient.isBlocked) return true;
  if (!patient.patientName) return false;

  return isAdmittedDuringShift(
    record.date,
    patient.admissionDate,
    patient.admissionTime,
    selectedShift
  );
};

export const hasVisibleHandoffPatients = (
  record: DailyRecordBedLayoutState | null,
  visibleBeds: BedDescriptor[],
  shouldShowPatient: (bedId: string) => boolean
): boolean => {
  if (!record) return false;

  return visibleBeds.some(bed => {
    const patient = record.beds[bed.id];
    if (!patient?.patientName && !patient?.isBlocked) return false;
    if (patient?.isBlocked) return true;
    return shouldShowPatient(bed.id);
  });
};
