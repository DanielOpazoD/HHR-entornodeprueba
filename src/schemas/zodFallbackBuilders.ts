import type { PatientData } from '@/types/domain/patient';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { CudyrScoreSchema } from '@/schemas/zod/patient';

export const buildFallbackPatientData = (data: unknown, bedId: string): PatientData => {
  const fallback = createEmptyPatient(bedId);
  const raw = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};

  if (typeof raw.patientName === 'string') fallback.patientName = raw.patientName;
  if (typeof raw.rut === 'string') fallback.rut = raw.rut;
  if (typeof raw.pathology === 'string') fallback.pathology = raw.pathology;
  if (typeof raw.age === 'string') fallback.age = raw.age;
  if (typeof raw.admissionDate === 'string') fallback.admissionDate = raw.admissionDate;
  if (typeof raw.admissionTime === 'string') fallback.admissionTime = raw.admissionTime;
  if (raw.isBlocked === true) fallback.isBlocked = true;
  if (raw.bedMode === 'Cama' || raw.bedMode === 'Cuna') fallback.bedMode = raw.bedMode;
  if (raw.hasCompanionCrib === true) fallback.hasCompanionCrib = true;

  const cudyr = CudyrScoreSchema.safeParse(raw.cudyr);
  if (cudyr.success) {
    fallback.cudyr = cudyr.data;
  }

  if (raw.clinicalCrib && typeof raw.clinicalCrib === 'object') {
    fallback.clinicalCrib = buildFallbackPatientData(raw.clinicalCrib, bedId);
  }

  return fallback;
};
