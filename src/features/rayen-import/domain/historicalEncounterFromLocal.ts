import type { PatientData } from '../contracts/rayenDomainContracts';
import type { RayenEncounter } from '../contracts/rayenSnapshot';

/** Maps a local HHR occupant to the shared historical-reconstruction identity contract. */
export const historicalEncounterFromLocal = (
  patient: PatientData,
  clinicalCribParentBedId?: string
): RayenEncounter => ({
  encounterId: patient.clinicalEpisodeId?.trim() ?? '',
  run: patient.rut,
  firstGivenName: patient.firstName?.trim() || patient.patientName,
  firstFamilyName: patient.lastName?.trim() || '',
  secondFamilyName: patient.secondLastName,
  birthDate: patient.birthDate,
  administrativeSex: patient.biologicalSex,
  gender: patient.biologicalSex,
  admissionDatetime: patient.admissionDate
    ? `${patient.admissionDate}T${patient.admissionTime || '00:00'}:00`
    : undefined,
  diagnosis: patient.pathology,
  diagnosisCode: patient.cie10Code,
  diagnosisDescription: patient.cie10Description,
  isIsolated: patient.isIsolated,
  isolationType: patient.isolationType,
  isolationMicroorganism: patient.isolationMicroorganism,
  service: patient.location,
  clinicalCribParentBedId,
});
