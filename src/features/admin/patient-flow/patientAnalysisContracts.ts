import type { DischargeData, TransferData } from '@/types/domain/movements';

export interface PatientAnalysisPatientContract {
  rut?: string;
  patientName?: string;
  admissionDate?: string;
  birthDate?: string;
  insurance?: string;
  biologicalSex?: string;
  pathology?: string;
}

export interface PatientAnalysisRecordContract {
  date: string;
  beds?: Record<string, PatientAnalysisPatientContract | undefined> | null;
  discharges?: DischargeData[] | null;
  transfers?: TransferData[] | null;
}
