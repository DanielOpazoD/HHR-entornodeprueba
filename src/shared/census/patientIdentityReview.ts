import type { PatientData } from '@/shared/contracts/patientDomainContracts';
import {
  PATIENT_IDENTITY_FIELDS,
  type PatientIdentityField,
  type PatientIdentityReview,
} from '@/types/domain/patientIdentity';

/** Where a review sits: the bed, or the newborn crib nested in it. */
type ReviewPlace = { bedId: string; slot?: PatientIdentityReview['slot'] };

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const isPatientIdentityField = (value: unknown): value is PatientIdentityField =>
  (PATIENT_IDENTITY_FIELDS as readonly unknown[]).includes(value);

export const isIdentityReview = (value: unknown): value is PatientIdentityReview =>
  isPlainObject(value) &&
  typeof value.bedId === 'string' &&
  Array.isArray(value.fields) &&
  value.fields.every(isPatientIdentityField) &&
  isPlainObject(value.shown) &&
  isPlainObject(value.stored);

type IdentityValues = Partial<Record<PatientIdentityField, unknown>>;

/** Whether `field` of `patient` still shows what the read of `review` showed. */
const showsAsRead = (
  patient: IdentityValues,
  review: PatientIdentityReview,
  field: PatientIdentityField
) => JSON.stringify(patient[field]) === JSON.stringify(review.shown[field]);

/**
 * Whether `patient`, in a bed or in the newborn crib of one, is still the occupant `review` was read
 * for: in the same slot, every field the read could show still showing what it showed.
 */
const holdsReadOccupant = (patient: IdentityValues, review: PatientIdentityReview, crib: boolean) =>
  (review.slot === 'clinicalCrib') === crib &&
  PATIENT_IDENTITY_FIELDS.every(
    field => review.fields.includes(field) || showsAsRead(patient, review, field)
  );

/** Where a review sits, as the census names it. */
export const identityReviewTitle = ({ bedId, slot }: ReviewPlace) =>
  `Identidad de ${slot === 'clinicalCrib' ? 'la cuna RN de la cama' : 'la cama'} ${bedId} por revisar`;

/** A stored identity that cannot be read, or a write that would replace one with a guess. */
export class PatientIdentityRepairRequiredError extends Error {
  readonly code = 'patient_identity_repair_required';
  readonly bedId: string;

  constructor(review: ReviewPlace) {
    super(`${identityReviewTitle(review)}.`);
    this.name = 'PatientIdentityRepairRequiredError';
    this.bedId = review.bedId;
  }
}

const BED_SLOT_PATH = /^beds\.[^.]+(\.clinicalCrib)?$/;
const REVIEW_KEY = /(^|\.)identityReview$/;

const repairRequired = (path: string, review: unknown) =>
  new PatientIdentityRepairRequiredError(
    isIdentityReview(review) ? review : { bedId: path.replace(/^beds\./, '') }
  );

// Copy on write: only the objects on the way to a review are rebuilt, so every other value,
// Firestore timestamps included, stays the same instance. `path` is where `value` sits in a day,
// whether the patch spells it nested or dotted.
const mapReviews = (value: unknown, path: string, store: boolean): unknown => {
  if (!value || typeof value !== 'object') return value;
  const next: Record<string, unknown> = {};
  let changed = false;
  Object.entries(value).forEach(([key, child]) => {
    const childPath = path ? `${path}.${key}` : key;
    if (REVIEW_KEY.test(key)) {
      // A patch of the review itself, even one that clears it, would erase what was not read.
      if (
        store &&
        (key !== 'identityReview' || (child !== undefined && !BED_SLOT_PATH.test(path)))
      ) {
        throw repairRequired(childPath.replace(REVIEW_KEY, ''), child);
      }
      changed = true;
      return;
    }
    next[key] = mapReviews(child, childPath, store);
    if (next[key] !== child) changed = true;
  });
  const review = (value as { identityReview?: unknown }).identityReview;
  if (store && review !== undefined) {
    if (
      !isIdentityReview(review) ||
      !review.fields.every(field => Object.hasOwn(review.stored, field))
    ) {
      throw repairRequired(path, review);
    }
    // Storage gets back what it held only for the occupant the review was read for, and only where a
    // value still shows what the read showed: a new patient, a repair or an edit is stored as written.
    if (holdsReadOccupant(next, review, path.endsWith('.clinicalCrib'))) {
      Object.entries(review.stored).forEach(([field, stored]) => {
        if (isPatientIdentityField(field) && showsAsRead(next, review, field)) next[field] = stored;
      });
    }
  }
  if (!changed) return value;
  return Array.isArray(value) ? Object.assign([], next) : next;
};

/**
 * What storage receives for a value leaving the device (a day, a patch, a snapshot): a bed or crib
 * under review goes back with no review, and with what storage held for each field it could not
 * show, unless the slot now holds another occupant or the field was written since. A review
 * anywhere else, such as a patient copied into a movement, would store a guess, so the write fails.
 */
export const withStoredIdentity = <T>(value: T): T => mapReviews(value, '', true) as T;

/**
 * Data read from outside this device (Firestore, a server answer) never brings an identity review:
 * only this client's own read of an identity sets one. Removes every review, wherever it sits, and
 * keeps everything else as it is.
 */
export const withoutStoredIdentityReviews = <T>(value: T): T => mapReviews(value, '', false) as T;

const identityOf = (patient: PatientData) =>
  JSON.stringify([PATIENT_IDENTITY_FIELDS.map(field => patient[field]), patient.identityReview]);

/** The clinical episode of a copy, when the copy could read it. */
const episodeOf = (patient: PatientData) =>
  patient.identityReview?.fields.includes('clinicalEpisodeId')
    ? undefined
    : patient.clinicalEpisodeId?.trim() || undefined;

/**
 * Whether two copies of a bed hold the same patient when either identity is under review: a copy
 * with that very identity, as shown and as stored, does, and so does one of the same clinical
 * episode, read on both: a repair of another field leaves the patient as it was. A name or an
 * admission date is no evidence. Undefined when neither is under review.
 */
export const isSameIdentityUnderReview = (a: PatientData, b: PatientData): boolean | undefined =>
  a.identityReview || b.identityReview
    ? identityOf(a) === identityOf(b) ||
      (episodeOf(a) !== undefined && episodeOf(a) === episodeOf(b))
    : undefined;

const PATCH_PATH = /^beds\.([^.]+)(?:\.(clinicalCrib))?(?:\.([^.]+))?$/;

/**
 * Keeps the reviews of a day in step with the patches applied to it. A patched identity field shows
 * what the patch wrote: it is no longer under review, and storage does not get back what it held for
 * it. A patch of a whole bed or crib keeps a review only for the occupant it was read for.
 */
export const clearReviewedIdentityFields = <T extends { beds: Record<string, PatientData> }>(
  record: T,
  patchPaths: readonly string[]
): T =>
  patchPaths.reduce<T>((current, path) => {
    const [, bedId, crib, field] = PATCH_PATH.exec(path) ?? [];
    const bed = bedId ? current.beds[bedId] : undefined;
    const target = crib ? bed?.clinicalCrib : bed;
    const review = target?.identityReview;
    if (!bed || !target || !review || (field && !isPatientIdentityField(field))) return current;
    const { identityReview: _review, ...next } = target;
    let kept: PatientIdentityReview | undefined = review;
    if (isPatientIdentityField(field)) {
      const { [field]: _stored, ...stored } = review.stored;
      const fields = review.fields.filter(reviewed => reviewed !== field);
      const shown = { ...review.shown, [field]: target[field] };
      kept = fields.length ? { ...review, fields, shown, stored } : undefined;
    } else if (!holdsReadOccupant(next, review, Boolean(crib))) {
      kept = undefined;
    }
    const patient = kept ? { ...next, identityReview: kept } : next;
    return {
      ...current,
      beds: { ...current.beds, [bedId]: crib ? { ...bed, clinicalCrib: patient } : patient },
    };
  }, record);
