import type { PatientData } from '@/types/domain/patient';

import {
  buildSpecialistHandoffIdentity,
  specialistHandoffIdentityKey,
} from '@/hooks/useMedicalHandoffDraft';

/** Rows and editors remount when the patient or episode changes, never only by bed. */
export const medicalHandoffPatientKey = (patient: PatientData): string =>
  specialistHandoffIdentityKey(buildSpecialistHandoffIdentity(patient));
