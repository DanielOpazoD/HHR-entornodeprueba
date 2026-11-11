import type { DailyRecordMedicalMessagingState } from '@/types/domain/dailyRecordSlices';

interface VisibleBed {
  id: string;
}

export interface ManualMedicalHandoffMessageModel {
  hospitalized: number;
  blockedBeds: number;
  freeBeds: number;
  formattedDate: string;
  doctorName: string;
}

export const buildManualMedicalHandoffMessageModel = (
  record: DailyRecordMedicalMessagingState,
  visibleBeds: VisibleBed[]
): ManualMedicalHandoffMessageModel => {
  const hospitalized = visibleBeds.filter(bed => {
    const patient = record.beds[bed.id];
    return patient && patient.patientName && !patient.isBlocked;
  }).length;

  const blockedBeds = visibleBeds.filter(bed => record.beds[bed.id]?.isBlocked).length;
  const freeBeds = visibleBeds.length - hospitalized - blockedBeds;
  const [year, month, day] = record.date.split('-');

  return {
    hospitalized,
    blockedBeds,
    freeBeds,
    formattedDate: `${day}-${month}-${year}`,
    doctorName: record.medicalHandoffDoctor || 'Sin especificar',
  };
};
