import {
  isIdentityReview,
  PatientIdentityRepairRequiredError,
} from '@/shared/census/patientIdentityReview';

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const keepStoredIdentity = (
  patient: PlainObject,
  storedPatient: unknown,
  writtenPaths: ReadonlySet<string>,
  basePath: string
): PlainObject => {
  const review = patient.identityReview;
  if (!isIdentityReview(review)) return patient;
  if (!isPlainObject(storedPatient)) throw new PatientIdentityRepairRequiredError(review);
  const { identityReview: _review, ...next } = patient;
  review.fields.forEach(field => {
    if (writtenPaths.has(`${basePath}.${field}`)) return;
    if (Object.hasOwn(storedPatient, field)) next[field] = storedPatient[field];
    else delete next[field];
  });
  return next;
};

/**
 * A queued day replays onto the stored day. A bed under identity review shows text or nothing
 * where its stored identity could not be read, so those fields go back exactly as stored, unless
 * the task wrote that exact field. With no stored bed there is nothing to keep, and the write stops
 * instead of storing the guess.
 */
export const adoptStoredIdentityUnderReview = <T extends object>(
  record: T,
  stored: unknown,
  changedPaths: readonly string[] = []
): T => {
  const source = record as PlainObject;
  if (!isPlainObject(source.beds)) return record;
  const storedBeds = isPlainObject(stored) && isPlainObject(stored.beds) ? stored.beds : {};
  const writtenPaths = new Set(changedPaths);
  let changed = false;
  const beds = Object.fromEntries(
    Object.entries(source.beds).map(([bedId, bed]) => {
      if (!isPlainObject(bed)) return [bedId, bed];
      const storedBed = storedBeds[bedId];
      let next = keepStoredIdentity(bed, storedBed, writtenPaths, `beds.${bedId}`);
      if (isPlainObject(next.clinicalCrib)) {
        const storedCrib = isPlainObject(storedBed) ? storedBed.clinicalCrib : undefined;
        const cribPath = `beds.${bedId}.clinicalCrib`;
        const crib = keepStoredIdentity(next.clinicalCrib, storedCrib, writtenPaths, cribPath);
        if (crib !== next.clinicalCrib) next = { ...next, clinicalCrib: crib };
      }
      if (next !== bed) changed = true;
      return [bedId, next];
    })
  );
  return changed ? ({ ...source, beds } as T) : record;
};
