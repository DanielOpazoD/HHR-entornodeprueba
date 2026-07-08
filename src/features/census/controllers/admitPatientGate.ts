/**
 * Decides whether an empty-bed demographics save qualifies as a "pure
 * admission" — meaning the user filled exactly the four fields the
 * canonical admit command knows about (patientName, rut, admissionDate,
 * optional pathology) and no other patient attribute is being mutated in
 * the same save.
 *
 * Why this gate exists:
 *
 * The legacy save path (updatePatientMultiple) accepts a Partial<PatientData>
 * with any subset of fields. The canonical admit command, on the other
 * hand, has a tight contract: it persists the four admission fields and
 * audits PATIENT_ADMITTED. If we routed every empty-bed save through the
 * command we would either:
 *   - silently drop fields the command does not know about, or
 *   - emit two audit events (PATIENT_ADMITTED from the command +
 *     PATIENT_MODIFIED from the legacy dispatch).
 *
 * This gate keeps the canonical command path narrow and predictable: the
 * command runs only when the save is exactly an admission, with no
 * additional fields. Mixed edits fall back to the legacy dispatch
 * untouched. The rollout is gated by the USE_ADMIT_PATIENT_COMMAND
 * feature flag (off by default).
 */
import type { PatientData } from '@/features/census/components/patient-row/patientRowContracts';
import { hasMeaningfulPatientIdentity } from '@/features/census/controllers/patientIdentityController';

export interface PureAdmissionInput {
  patientName: string;
  rut: string;
  admissionDate: string;
  pathology?: string;
}

const ADMISSION_FIELD_NAMES: ReadonlySet<keyof PatientData> = new Set([
  'patientName',
  'rut',
  'admissionDate',
  'pathology',
]);

const REQUIRED_ADMISSION_FIELDS = ['patientName', 'rut', 'admissionDate'] as const;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Returns the typed admission input when `updatedFields` contains exactly
 * (a) all three required admission fields with non-empty values, and (b)
 * no other field besides the optional pathology. Otherwise returns null,
 * meaning the caller should fall back to the legacy updatePatientMultiple
 * dispatch.
 */
export const resolvePureAdmissionInput = (
  updatedFields: Partial<PatientData>
): PureAdmissionInput | null => {
  const fieldNames = Object.keys(updatedFields) as Array<keyof PatientData>;

  for (const field of fieldNames) {
    if (!ADMISSION_FIELD_NAMES.has(field)) {
      // Mixed edit (e.g., touches bedMode, status, devices, etc.) →
      // stay on the legacy path so the command does not silently drop
      // fields it does not own.
      return null;
    }
  }

  for (const required of REQUIRED_ADMISSION_FIELDS) {
    if (!isNonEmptyString(updatedFields[required])) {
      return null;
    }
  }

  const pathology = updatedFields.pathology;
  return {
    patientName: (updatedFields.patientName ?? '').trim(),
    rut: (updatedFields.rut ?? '').trim(),
    admissionDate: (updatedFields.admissionDate ?? '').trim(),
    pathology: typeof pathology === 'string' ? pathology : undefined,
  };
};

/**
 * Single source of truth for the empty-bed save routing decision used by
 * `CensusTable.saveEmptyBedDemographics`. Returning a tagged action keeps
 * the dispatch logic pure (no React, no feature-flag singleton, no
 * notifications) so it can be exhaustively unit-tested without rendering
 * the table tree.
 *
 *  - `noop`           → the modal collected nothing meaningful; just close
 *                       it without writing.
 *  - `admit-command`  → flag enabled AND the input is exactly an admission;
 *                       caller awaits `useAdmitPatient` and surfaces the
 *                       typed outcome.
 *  - `legacy-dispatch` → flag disabled OR the input mixes non-admission
 *                       fields; caller delegates to `updatePatientMultiple`.
 */
export type EmptyBedSaveAction =
  | { kind: 'noop' }
  | { kind: 'admit-command'; input: PureAdmissionInput }
  | { kind: 'legacy-dispatch'; input: Partial<PatientData> };

export const resolveEmptyBedSaveAction = ({
  updatedFields,
  isAdmitCommandEnabled,
}: {
  updatedFields: Partial<PatientData>;
  isAdmitCommandEnabled: boolean;
}): EmptyBedSaveAction => {
  if (!hasMeaningfulPatientIdentity(updatedFields)) {
    return { kind: 'noop' };
  }

  if (isAdmitCommandEnabled) {
    const pureAdmission = resolvePureAdmissionInput(updatedFields);
    if (pureAdmission) {
      return { kind: 'admit-command', input: pureAdmission };
    }
  }

  return { kind: 'legacy-dispatch', input: updatedFields };
};
