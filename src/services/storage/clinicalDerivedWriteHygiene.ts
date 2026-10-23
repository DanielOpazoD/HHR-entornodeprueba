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
 * The overlay is not imported, so eager write paths do not pull it in.
 */
import {
  CLINICAL_DERIVED_LAYOUT_FIELD,
  CLINICAL_DERIVED_MOVED_FIELDS,
} from '@/services/storage/clinicalDerivedConstants';
import { ensurePatientClinicalEpisodeId } from '@/application/patient-flow/clinicalEpisodeIdPolicy';

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

/**
 * True when a day carries the marker key, whatever its value (`null` included): the rules' notion
 * (`'clinicalDerivedLayout' in resource.data`), so a direct write never changes a stored key.
 * Reads follow `readClinicalDerivedLayout` in clinicalDerivedContract.ts instead.
 */
export const carriesClinicalDerivedLayout = (record: unknown): boolean =>
  isPlainObject(record) && record[CLINICAL_DERIVED_LAYOUT_FIELD] !== undefined;

// The episode id, or for a holder without one the id the legacy backfill of every client save
// (ensureDailyRecordClinicalEpisodeIds) gives it: a stored id-less patient still matches its local
// copy, and nobody else's. An empty holder has no key.
const episodeKeyOf = (holder: PlainObject): string =>
  String(
    ensurePatientClinicalEpisodeId(holder as Parameters<typeof ensurePatientClinicalEpisodeId>[0])
      .clinicalEpisodeId ?? ''
  ).trim();

interface StoredHolder extends Holder {
  key: string;
}

const holdersOf = (record: PlainObject): StoredHolder[] =>
  Object.entries(isPlainObject(record.beds) ? record.beds : {}).flatMap(([bedId, bed]) => {
    if (!isPlainObject(bed)) return [];
    const holders: StoredHolder[] = [{ bedId, target: 'bed', holder: bed, key: episodeKeyOf(bed) }];
    if (isPlainObject(bed.clinicalCrib)) {
      const crib = bed.clinicalCrib;
      holders.push({ bedId, target: 'clinicalCrib', holder: crib, key: episodeKeyOf(crib) });
    }
    return holders;
  });

const sameSlotOf = (
  stored: StoredHolder[],
  local: Omit<Holder, 'holder'>
): StoredHolder | undefined =>
  stored.find(candidate => candidate.bedId === local.bedId && candidate.target === local.target);

/**
 * The stored holder of the same episode, wherever it is (a crib<->bed move keeps the id). Blocked
 * holders are not active (as in clinicalDerivedContract.ts) and only match a blocked holder in
 * their own slot; a key stored more than once only matches its own slot; no key, no match.
 */
const findStoredHolder = (stored: StoredHolder[], local: Holder): PlainObject | undefined => {
  const sameSlot = sameSlotOf(stored, local);
  if (local.holder.isBlocked) return sameSlot?.holder.isBlocked ? sameSlot.holder : undefined;
  const key = episodeKeyOf(local.holder);
  if (!key) return undefined;
  const matches = stored.filter(candidate => !candidate.holder.isBlocked && candidate.key === key);
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
  if (!carriesClinicalDerivedLayout(stored)) {
    if (!hasOwn(source, CLINICAL_DERIVED_LAYOUT_FIELD)) return record;
    const stripped: PlainObject = { ...source };
    delete stripped[CLINICAL_DERIVED_LAYOUT_FIELD];
    return stripped as T;
  }

  const storedDay = stored as PlainObject;
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
 * `set(..., { merge: true })` keeps every key the payload omits. On a marked stored day, a moved
 * field that the adopted payload leaves out of a holder while the stored holder in the same slot
 * still carries it (another episode's copy, or one that is not this holder's) gets `clearValue()`,
 * so the merged slot ends up as a full `set` would leave it: absent stored, absent result (D9).
 * Pass the sanitized payload (sanitizeForFirestore would flatten a sentinel). Unmarked stored
 * days, and payloads with nothing to clear, come back as the same object.
 */
export const withClearedStoredMovedFields = (
  payload: PlainObject,
  stored: unknown,
  clearValue: () => unknown
): PlainObject => {
  if (!carriesClinicalDerivedLayout(stored) || !isPlainObject(payload.beds)) return payload;
  const storedHolders = holdersOf(stored as PlainObject);
  const clearMissing = (holder: PlainObject, slot: Omit<Holder, 'holder'>): PlainObject => {
    const storedHolder = sameSlotOf(storedHolders, slot)?.holder;
    const missing = CLINICAL_DERIVED_MOVED_FIELDS.filter(
      field => storedHolder?.[field] !== undefined && holder[field] === undefined
    );
    if (missing.length === 0) return holder;
    const next: PlainObject = { ...holder };
    missing.forEach(field => {
      next[field] = clearValue();
    });
    return next;
  };

  let changed = false;
  const beds: PlainObject = {};
  Object.entries(payload.beds).forEach(([bedId, bed]) => {
    if (!isPlainObject(bed)) {
      beds[bedId] = bed;
      return;
    }
    let nextBed = clearMissing(bed, { bedId, target: 'bed' });
    if (isPlainObject(bed.clinicalCrib)) {
      const crib = clearMissing(bed.clinicalCrib, { bedId, target: 'clinicalCrib' });
      if (crib !== bed.clinicalCrib) nextBed = { ...nextBed, clinicalCrib: crib };
    }
    if (nextBed !== bed) changed = true;
    beds[bedId] = nextBed;
  });
  return changed ? { ...payload, beds } : payload;
};

/**
 * Imports never replace a local split day with a copy that lost its marker, or carries another
 * one, unless that copy is strictly newer (an unreadable timestamp keeps the local day).
 */
const lastUpdatedMs = (record: unknown): number =>
  Date.parse(String(isPlainObject(record) ? (record.lastUpdated ?? '') : ''));

const sameMarker = (left: PlainObject, right: unknown): boolean =>
  isPlainObject(right) &&
  JSON.stringify(left[CLINICAL_DERIVED_LAYOUT_FIELD]) ===
    JSON.stringify(right[CLINICAL_DERIVED_LAYOUT_FIELD]);

export const isClinicalDerivedLayoutRegression = (local: unknown, incoming: unknown): boolean => {
  if (!carriesClinicalDerivedLayout(local) || sameMarker(local as PlainObject, incoming)) {
    return false;
  }
  const localMs = lastUpdatedMs(local);
  const incomingMs = lastUpdatedMs(incoming);
  return !(Number.isFinite(localMs) && Number.isFinite(incomingMs) && incomingMs > localMs);
};
