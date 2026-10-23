/**
 * Client write hygiene for split days (D3 and D9 of
 * docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md). Only the server writes the marker and the
 * moved fields of a split day, so a client never writes them from its local copy:
 *
 * - the stored day owns the marker: a create never carries one (the create rule denies it) and an
 *   update leaves it exactly as stored;
 * - on a day that carries a marker the stored day also owns `meta` (direct writes never lower the
 *   revision) and, per `clinicalEpisodeId`, the moved fields (the embedded copy of an episode not
 *   split yet is kept, never deleted).
 *
 * Used by the conflict auto-merge (stored = the remote record) and by the direct writes that read
 * the remote in their transaction (stored = the snapshot data, or undefined when the day does not
 * exist). Without a marker on either side the same object is returned: unmarked days are a no-op.
 * Only the constants are imported, so eager write paths do not pull in the overlay.
 */
import {
  CLINICAL_DERIVED_LAYOUT_FIELD,
  CLINICAL_DERIVED_MOVED_FIELDS,
} from '@/services/storage/clinicalDerivedConstants';

type PlainObject = Record<string, unknown>;

interface Holder {
  bedId: string;
  target: 'bed' | 'clinicalCrib';
  holder: PlainObject;
}

const isPlainObject = (value: unknown): value is PlainObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

// Only arrays and plain objects are copied; a Timestamp or any other instance is shared as is.
const clonePlain = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (!isPlainObject(value)) return value;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clonePlain(item)]));
};

/** True when a stored or local day carries the marker, whatever its shape. */
export const carriesClinicalDerivedLayout = (record: unknown): boolean =>
  isPlainObject(record) &&
  record[CLINICAL_DERIVED_LAYOUT_FIELD] !== undefined &&
  record[CLINICAL_DERIVED_LAYOUT_FIELD] !== null;

const episodeIdOf = (holder: PlainObject): string =>
  typeof holder.clinicalEpisodeId === 'string' ? holder.clinicalEpisodeId.trim() : '';

const holdersOf = (record: PlainObject): Holder[] =>
  Object.entries(isPlainObject(record.beds) ? record.beds : {}).flatMap(([bedId, bed]) => {
    if (!isPlainObject(bed)) return [];
    const holders: Holder[] = [{ bedId, target: 'bed', holder: bed }];
    if (isPlainObject(bed.clinicalCrib)) {
      holders.push({ bedId, target: 'clinicalCrib', holder: bed.clinicalCrib });
    }
    return holders;
  });

/**
 * The stored holder of the same episode, wherever it is (a crib<->bed move keeps the id). An id
 * stored more than once only matches its own slot; a holder without an id only matches its own
 * slot when that one has no id either.
 */
const findStoredHolder = (stored: Holder[], local: Holder): PlainObject | undefined => {
  const sameSlot = stored.find(
    candidate => candidate.bedId === local.bedId && candidate.target === local.target
  );
  const episodeId = episodeIdOf(local.holder);
  if (!episodeId) {
    return sameSlot && !episodeIdOf(sameSlot.holder) ? sameSlot.holder : undefined;
  }
  const matches = stored.filter(candidate => episodeIdOf(candidate.holder) === episodeId);
  if (matches.length === 1) return matches[0].holder;
  return matches.find(candidate => candidate === sameSlot)?.holder;
};

const withStoredMovedFields = (
  holder: PlainObject,
  storedHolder: PlainObject | undefined
): PlainObject => {
  const next: PlainObject = { ...holder };
  CLINICAL_DERIVED_MOVED_FIELDS.forEach(field => {
    // Deleted, never set to undefined: sanitizeForFirestore would write that as null.
    delete next[field];
    if (storedHolder && storedHolder[field] !== undefined) {
      next[field] = clonePlain(storedHolder[field]);
    }
  });
  return next;
};

/**
 * `record` as a client may write it over `stored`: the stored marker (none when the day does not
 * exist or is unmarked) and, on a marked stored day, the stored `meta` and moved fields.
 */
export const adoptStoredClinicalDerivedState = <T extends object>(
  record: T,
  stored: unknown
): T => {
  const source = record as PlainObject;
  const storedDay = isPlainObject(stored) ? stored : undefined;
  if (!storedDay || storedDay[CLINICAL_DERIVED_LAYOUT_FIELD] === undefined) {
    if (!hasOwn(source, CLINICAL_DERIVED_LAYOUT_FIELD)) return record;
    const stripped: PlainObject = { ...source };
    delete stripped[CLINICAL_DERIVED_LAYOUT_FIELD];
    return stripped as T;
  }

  const next: PlainObject = {
    ...source,
    [CLINICAL_DERIVED_LAYOUT_FIELD]: clonePlain(storedDay[CLINICAL_DERIVED_LAYOUT_FIELD]),
  };
  if (storedDay.meta !== undefined) next.meta = clonePlain(storedDay.meta);
  else delete next.meta;

  if (isPlainObject(source.beds)) {
    const storedHolders = holdersOf(storedDay);
    const beds: PlainObject = {};
    Object.entries(source.beds).forEach(([bedId, bed]) => {
      if (!isPlainObject(bed)) {
        beds[bedId] = bed;
        return;
      }
      const nextBed = withStoredMovedFields(
        bed,
        findStoredHolder(storedHolders, { bedId, target: 'bed', holder: bed })
      );
      if (isPlainObject(bed.clinicalCrib)) {
        nextBed.clinicalCrib = withStoredMovedFields(
          bed.clinicalCrib,
          findStoredHolder(storedHolders, {
            bedId,
            target: 'clinicalCrib',
            holder: bed.clinicalCrib,
          })
        );
      }
      beds[bedId] = nextBed;
    });
    next.beds = beds;
  }
  return next as T;
};

/**
 * Imports never replace a local split day with a copy that lost its marker unless that copy is
 * strictly newer (an unreadable timestamp keeps the local day).
 */
const lastUpdatedMs = (record: unknown): number =>
  Date.parse(String(isPlainObject(record) ? (record.lastUpdated ?? '') : ''));

export const isClinicalDerivedLayoutRegression = (local: unknown, incoming: unknown): boolean => {
  if (!carriesClinicalDerivedLayout(local) || carriesClinicalDerivedLayout(incoming)) return false;
  const localMs = lastUpdatedMs(local);
  const incomingMs = lastUpdatedMs(incoming);
  return !(Number.isFinite(localMs) && Number.isFinite(incomingMs) && incomingMs > localMs);
};
