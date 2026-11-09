import type { PatientData } from '@/types/domain/patient';

const PATIENT_NAME_FIELDS = new Set<string>([
  'patientName',
  'firstName',
  'lastName',
  'secondLastName',
]);

/**
 * A name edited in HHR is no longer Eloísa's split, so its marker must go. An update that states
 * its own source (a whole patient being restored) keeps it.
 */
export const editsEloisaNameParts = (
  current: Partial<PatientData> | undefined,
  updates: Partial<PatientData>
): boolean =>
  current?.namePartsSource !== undefined &&
  !Object.prototype.hasOwnProperty.call(updates, 'namePartsSource') &&
  Object.entries(updates).some(
    ([field, value]) =>
      PATIENT_NAME_FIELDS.has(field) && value !== current[field as keyof PatientData]
  );
