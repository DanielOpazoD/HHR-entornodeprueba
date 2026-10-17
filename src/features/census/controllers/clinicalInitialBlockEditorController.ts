import { SPECIALTY_OPTIONS } from '@/constants/clinicalSpecialtyConstants';
import type { ProfessionalCatalogItem } from '@/types/domain/professionals';
import type {
  PatientData,
  PatientRowPatientPatch,
} from '@/features/census/components/patient-row/patientRowContracts';
import {
  findProfessionalByCatalogKey,
  findProfessionalByRayenIdentity,
  professionalCatalogKey,
} from '@/services/staff/treatingPhysicianCatalog';
import {
  dismissTreatingPhysician,
  isDismissedTreatingPhysician,
} from '@/shared/census/treatingPhysicianDismissal';

// The clinical status was decoupled from this editor (rediseño 2026): it now lives in its own
// column as a colored dot (StatusSelect). This editor only edits diagnosis + specialty.
export interface ClinicalInitialBlockDraft {
  pathology: string;
  treatingPhysicianKey: string;
  physicianTouched: boolean;
  specialtySelection: string;
  specialtyOther: string;
  specialtyTouched: boolean;
}
export const isKnownSpecialtyOption = (specialty: string): boolean =>
  specialty === '' || SPECIALTY_OPTIONS.includes(specialty as (typeof SPECIALTY_OPTIONS)[number]);
export const buildClinicalInitialBlockDraft = (
  data: PatientData,
  professionalsCatalog: ProfessionalCatalogItem[]
): ClinicalInitialBlockDraft => {
  const specialty = data.specialty || '';
  const isKnownSpecialty = isKnownSpecialtyOption(specialty);
  const matchingProfessional = findProfessionalByRayenIdentity(
    professionalsCatalog,
    data.treatingPhysicianId,
    data.treatingPhysicianName
  );
  const storedPhysicianDismissed = isDismissedTreatingPhysician(data, data);

  return {
    pathology: data.pathology || '',
    physicianTouched: false,
    specialtyTouched: false,
    treatingPhysicianKey: storedPhysicianDismissed
      ? ''
      : matchingProfessional
        ? professionalCatalogKey(matchingProfessional)
        : data.treatingPhysicianId
          ? `rayen:${data.treatingPhysicianId}`
          : data.treatingPhysicianName
            ? `stored-name:${encodeURIComponent(data.treatingPhysicianName)}`
            : '',
    specialtySelection: isKnownSpecialty ? specialty : 'Otro',
    specialtyOther: isKnownSpecialty ? '' : specialty,
  };
};
export const buildClinicalInitialBlockPatch = (
  draft: ClinicalInitialBlockDraft,
  professionalsCatalog: ProfessionalCatalogItem[],
  data: PatientData
): PatientRowPatientPatch => {
  const selectedProfessional = findProfessionalByCatalogKey(
    professionalsCatalog,
    draft.treatingPhysicianKey
  );
  const currentProfessional = findProfessionalByRayenIdentity(
    professionalsCatalog,
    data.treatingPhysicianId,
    data.treatingPhysicianName
  );
  const keepsStoredIdentity =
    Boolean(draft.treatingPhysicianKey) ||
    (!draft.physicianTouched && isDismissedTreatingPhysician(data, data));
  const physicianId = selectedProfessional
    ? selectedProfessional.rayenPractitionerId
    : draft.treatingPhysicianKey.startsWith('rayen:')
      ? draft.treatingPhysicianKey.slice('rayen:'.length)
      : keepsStoredIdentity
        ? data.treatingPhysicianId
        : undefined;
  const physicianName =
    selectedProfessional?.name ?? (keepsStoredIdentity ? data.treatingPhysicianName : undefined);
  return {
    pathology: draft.pathology,
    treatingPhysicianId: physicianId,
    treatingPhysicianName: physicianName,
    ...(draft.physicianTouched
      ? physicianId || physicianName
        ? isDismissedTreatingPhysician(data, {
            ...data,
            treatingPhysicianId: physicianId,
            treatingPhysicianName: physicianName,
          })
          ? { dismissedTreatingPhysician: undefined }
          : {}
        : data.treatingPhysicianId || data.treatingPhysicianName
          ? dismissTreatingPhysician(data, {
              practitionerId: currentProfessional?.rayenPractitionerId,
              name: currentProfessional?.name,
            })
          : {}
      : {}),
    ...(draft.specialtyTouched
      ? {
          specialty: (draft.specialtySelection === 'Otro'
            ? draft.specialtyOther.trim() || 'Otro'
            : draft.specialtySelection) as PatientData['specialty'],
        }
      : {}),
  };
};
