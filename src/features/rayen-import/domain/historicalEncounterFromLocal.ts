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
  admissionDatetime: patient.admissionDate
    ? `${patient.admissionDate}T${patient.admissionTime || '00:00'}:00`
    : undefined,
  diagnosis: patient.pathology,
  service: patient.location,
  clinicalCribParentBedId,
});
