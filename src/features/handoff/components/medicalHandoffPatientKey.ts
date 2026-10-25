import type { PatientData } from '@/domain/handoff/patientContracts';
import { buildLegacyClinicalEpisodeId } from '@/application/patient-flow/clinicalEpisodeIdPolicy';

export const medicalHandoffPatientKey = (patient: PatientData): string =>
  JSON.stringify([
    patient.documentType || 'RUT',
    patient.rut,
    patient.patientName,
    patient.clinicalEpisodeId || buildLegacyClinicalEpisodeId(patient),
  ]);
