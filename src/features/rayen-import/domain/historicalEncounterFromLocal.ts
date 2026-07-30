import type { PatientData } from '../contracts/rayenDomainContracts';
import type { RayenEncounter } from '../contracts/rayenSnapshot';

const historicalSexLabels = (
  biologicalSex: PatientData['biologicalSex']
): Pick<RayenEncounter, 'administrativeSex' | 'gender'> => {
  if (biologicalSex === 'Femenino') {
    return { administrativeSex: 'Mujer', gender: 'Femenina' };
  }
  if (biologicalSex === 'Masculino') {
    return { administrativeSex: 'Hombre', gender: 'Masculino' };
  }
  return { administrativeSex: undefined, gender: undefined };
};

/** Maps a local HHR occupant to the shared historical-reconstruction identity contract. */
export const historicalEncounterFromLocal = (
  patient: PatientData,
  clinicalCribParentBedId?: string
): RayenEncounter => {
  const sex = historicalSexLabels(patient.biologicalSex);
  return {
    encounterId: patient.clinicalEpisodeId?.trim() ?? '',
    run: patient.rut,
    firstGivenName: patient.firstName?.trim() || patient.patientName,
    firstFamilyName: patient.lastName?.trim() || '',
    secondFamilyName: patient.secondLastName,
    birthDate: patient.birthDate,
    ...sex,
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
  };
};
