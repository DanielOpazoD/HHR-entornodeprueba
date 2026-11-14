import type { PatientData } from '@/types/domain/patient';

export const validatePatientDischarge = (
  patient: Pick<PatientData, 'patientName' | 'admissionDate'>
): boolean => Boolean(patient.patientName?.trim() && patient.admissionDate);
