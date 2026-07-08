import type { CMAData, DischargeData } from '@/features/census/contracts/censusMovementContracts';
import type { PatientData } from '@/features/census/controllers/censusActionPatientContracts';
import { createEmptyPatient } from '@/services/factories/patientFactory';

const applyMovementEpisodeId = <T extends PatientData>(
  patient: T,
  clinicalEpisodeId?: string
): T => ({
  ...patient,
  clinicalEpisodeId: clinicalEpisodeId || patient.clinicalEpisodeId,
});

export const buildDischargeClinicalDocumentsPatientSnapshot = (
  item: DischargeData,
  recordDate: string
): PatientData => {
  if (item.originalData) {
    return applyMovementEpisodeId(item.originalData, item.clinicalEpisodeId);
  }

  return {
    ...createEmptyPatient(item.bedId),
    bedName: item.bedName,
    patientName: item.patientName,
    rut: item.rut,
    age: item.age || '',
    insurance: item.insurance as PatientData['insurance'],
    origin: item.origin as PatientData['origin'],
    isRapanui: item.isRapanui,
    pathology: item.diagnosis,
    specialty: item.specialty as PatientData['specialty'],
    admissionDate: item.admissionDate || item.movementDate || recordDate,
    clinicalEpisodeId: item.clinicalEpisodeId,
  };
};

export const buildCmaClinicalDocumentsPatientSnapshot = (
  item: CMAData,
  recordDate: string
): PatientData => {
  if (item.originalData) {
    return applyMovementEpisodeId(item.originalData, item.clinicalEpisodeId);
  }

  return {
    ...createEmptyPatient(item.originalBedId || item.id),
    bedName: item.bedName,
    patientName: item.patientName,
    rut: item.rut,
    age: item.age,
    birthDate: item.birthDate,
    biologicalSex: item.biologicalSex,
    insurance: item.insurance,
    admissionOrigin: item.admissionOrigin,
    admissionOriginDetails: item.admissionOriginDetails,
    origin: item.origin,
    isRapanui: item.isRapanui,
    pathology: item.diagnosis,
    cie10Code: item.cie10Code,
    cie10Description: item.cie10Description,
    specialty: item.specialty as PatientData['specialty'],
    admissionDate: recordDate,
    clinicalEpisodeId: item.clinicalEpisodeId,
  };
};
