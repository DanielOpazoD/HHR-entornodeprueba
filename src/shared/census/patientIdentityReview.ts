import type { PatientData } from '@/types/domain/patient';
import {
  PATIENT_IDENTITY_FIELDS,
  type PatientIdentityField,
  type PatientIdentityReview,
} from '@/types/domain/patientIdentity';

const FIELD_LABELS: Record<PatientIdentityField, string> = {
  documentType: 'tipo de documento',
  rut: 'RUT o pasaporte',
  clinicalEpisodeId: 'episodio',
  identityStatus: 'estado de identidad',
  patientName: 'nombre',
  firstName: 'nombres',
  lastName: 'primer apellido',
  secondLastName: 'segundo apellido',
  admissionDate: 'fecha de ingreso',
  admissionTime: 'hora de ingreso',
};

const SLOTS: ReadonlySet<unknown> = new Set<PatientIdentityReview['slot']>(['bed', 'clinicalCrib']);

type ReviewFields = PatientIdentityReview['fields'];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isPatientIdentityField = (value: unknown): value is PatientIdentityField =>
  (PATIENT_IDENTITY_FIELDS as readonly unknown[]).includes(value);

/** Identity fields in their canonical order, or null when there are none. */
export const toReviewFields = (fields: Iterable<PatientIdentityField>): ReviewFields | null => {
  const present = new Set(fields);
  const [first, ...rest] = PATIENT_IDENTITY_FIELDS.filter(field => present.has(field));
  return first ? [first, ...rest] : null;
};

export const isIdentityReview = (value: unknown): value is PatientIdentityReview =>
  isPlainObject(value) &&
  typeof value.bedId === 'string' &&
  SLOTS.has(value.slot) &&
  Array.isArray(value.fields) &&
  value.fields.length > 0 &&
  value.fields.every(isPatientIdentityField);

export const describeIdentityReview = ({ bedId, slot, fields }: PatientIdentityReview): string =>
  `Identidad de ${slot === 'clinicalCrib' ? 'la cuna RN de la cama' : 'la cama'} ${bedId} ` +
  `por revisar: ${fields.map(field => FIELD_LABELS[field]).join(', ')}.`;

/** A stored identity that cannot be read, or a write that would replace one with a guess. */
export class PatientIdentityRepairRequiredError extends Error {
  readonly code = 'patient_identity_repair_required';
  readonly bedId: string;
  readonly slot: PatientIdentityReview['slot'];
  readonly fields: ReviewFields;

  constructor(review: PatientIdentityReview) {
    super(describeIdentityReview(review));
    this.name = 'PatientIdentityRepairRequiredError';
    this.bedId = review.bedId;
    this.slot = review.slot;
    this.fields = review.fields;
  }
}

/** Every identity review carried by a value about to leave the device. */
export const findIdentityReviews = (value: unknown): PatientIdentityReview[] => {
  const found: PatientIdentityReview[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isPlainObject(node)) return;
    if (isIdentityReview(node.identityReview)) found.push(node.identityReview);
    Object.values(node).forEach(visit);
  };
  visit(value);
  return found;
};

/**
 * A reviewed patient copied whole (full save, whole-bed patch, move, copy, discharge snapshot,
 * new day) would store its shown text or unset values as if they were read. Only field-by-field
 * edits may reach it until the identity is repaired.
 */
export const assertNoIdentityReviewInWrite = (value: unknown): void => {
  const [review] = findIdentityReviews(value);
  if (review) throw new PatientIdentityRepairRequiredError(review);
};

const withoutReviewedField = (patient: PatientData, field: PatientIdentityField): PatientData => {
  const { identityReview, ...rest } = patient;
  const fields = identityReview
    ? toReviewFields(identityReview.fields.filter(reviewed => reviewed !== field))
    : null;
  return identityReview && fields
    ? { ...rest, identityReview: { ...identityReview, fields } }
    : rest;
};

const BED_FIELD_PATH = /^beds\.([^.]+)\.(?:(clinicalCrib)\.)?([^.]+)$/;

/** A field written explicitly by a patch is no longer under review; the write validated it. */
export const clearReviewedIdentityFields = <T extends { beds: Record<string, PatientData> }>(
  record: T,
  patchPaths: readonly string[]
): T =>
  patchPaths.reduce<T>((current, path) => {
    const [, bedId, crib, field] = BED_FIELD_PATH.exec(path) ?? [];
    const bed = bedId ? current.beds[bedId] : undefined;
    const target = crib ? bed?.clinicalCrib : bed;
    if (!bed || !target?.identityReview || !isPatientIdentityField(field)) return current;
    if (!target.identityReview.fields.includes(field)) return current;
    const next = withoutReviewedField(target, field);
    return {
      ...current,
      beds: { ...current.beds, [bedId]: crib ? { ...bed, clinicalCrib: next } : next },
    };
  }, record);

const withoutStoredReview = (value: unknown): unknown => {
  if (!isPlainObject(value) || !('identityReview' in value)) return value;
  const { identityReview: _stored, ...rest } = value;
  return rest;
};

/** A review read back from Firestore is not evidence: only this client's own read sets one. */
export const withoutStoredIdentityReviews = (beds: unknown): unknown => {
  if (!isPlainObject(beds)) return beds;
  return Object.fromEntries(
    Object.entries(beds).map(([bedId, bed]) => {
      const patient = withoutStoredReview(bed);
      return [
        bedId,
        isPlainObject(patient) && isPlainObject(patient.clinicalCrib)
          ? { ...patient, clinicalCrib: withoutStoredReview(patient.clinicalCrib) }
          : patient,
      ];
    })
  );
};
