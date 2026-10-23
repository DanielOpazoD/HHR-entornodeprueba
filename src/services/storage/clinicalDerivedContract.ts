/**
 * Shared contract for the per-episode clinical data moved out of the daily record (phase 1a,
 * docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md) — client side.
 *
 * On a marked day the moved fields of each bed patient and clinical crib live in
 * `hospitals/{hospitalId}/dailyRecords/{date}/clinicalDerived/{clinicalEpisodeId}`, one small
 * document per day and episode that only the server writes. Readers combine both with
 * `overlayClinicalDerived`; the combined view never goes back into a write, IndexedDB or the
 * TanStack cache.
 *
 * The server twin is `functions/lib/clinicalDerivedContract.js`. The alignment test
 * (clinicalDerivedContractAlignment) runs the same synthetic matrix through both copies: change
 * one, change the other. The constants live in `clinicalDerivedConstants.ts` (eager modules import
 * them from there) and are re-exported here.
 */
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type {
  ClinicalDerivedEpisodeDoc,
  ClinicalDerivedLayout,
  ClinicalDerivedTarget,
} from '@/types/domain/clinicalDerived';
import {
  CLINICAL_DERIVED_DOC_SCHEMA_VERSION,
  CLINICAL_DERIVED_LAYOUT_FIELD,
  CLINICAL_DERIVED_LAYOUT_VERSION,
  CLINICAL_DERIVED_MIN_CLIENT_RUNTIME_CONTRACT_VERSION,
  CLINICAL_DERIVED_MOVED_FIELDS,
} from '@/services/storage/clinicalDerivedConstants';

export {
  CLIENT_RUNTIME_CONTRACT_VERSION_FIELD,
  CLINICAL_DERIVED_COLLECTION,
  CLINICAL_DERIVED_DOC_SCHEMA_VERSION,
  CLINICAL_DERIVED_LAYOUT_FIELD,
  CLINICAL_DERIVED_LAYOUT_VERSION,
  CLINICAL_DERIVED_MIN_CLIENT_RUNTIME_CONTRACT_VERSION,
  CLINICAL_DERIVED_MOVED_FIELDS,
  CLINICAL_DERIVED_TARGETS,
} from '@/services/storage/clinicalDerivedConstants';

export type ClinicalDerivedLayoutState =
  | { status: 'unmarked' }
  | { status: 'marked'; layout: ClinicalDerivedLayout }
  | { status: 'unsupported' };

export interface ClinicalDerivedEpisodeRef {
  bedId: string;
  target: ClinicalDerivedTarget;
  clinicalEpisodeId: string;
}

export interface ClinicalDerivedOverlayResult {
  record: DailyRecord;
  /** Active episodes that found a current document (sorted). */
  matchedEpisodeIds: string[];
  /** Ids active more than once that have a current document; left embedded. */
  skippedDuplicateEpisodeIds: string[];
}

type PlainObject = Record<string, unknown>;

const DOC_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
// Firestore reserves ids shaped like `__x__`; the character class alone would accept them.
const RESERVED_DOC_ID_PATTERN = /^__.*__$/;

const isPlainObject = (value: unknown): value is PlainObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

// Only arrays and plain objects are copied; a Timestamp, a Date or any other instance is shared
// as is, never flattened into `{}`.
const isPlainPrototype = (value: unknown): value is PlainObject => {
  if (!isPlainObject(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const clonePlain = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (!isPlainPrototype(value)) return value;
  const copy: PlainObject = {};
  Object.keys(value).forEach(key => {
    copy[key] = clonePlain(value[key]);
  });
  return copy;
};

/** Episode ids and layout generations double as Firestore document ids. */
export const isClinicalDerivedDocId = (value: unknown): value is string =>
  typeof value === 'string' && DOC_ID_PATTERN.test(value) && !RESERVED_DOC_ID_PATTERN.test(value);

export const buildClinicalDerivedLayout = (generation: string): ClinicalDerivedLayout => {
  if (!isClinicalDerivedDocId(generation)) {
    throw new Error('clinicalDerived layout generation must be a valid document id.');
  }
  return { version: CLINICAL_DERIVED_LAYOUT_VERSION, generation };
};

/**
 * `unmarked` (no marker), `marked` (a v1 marker) or `unsupported` (a marker this code does not
 * understand; callers must not treat that day as unmarked).
 */
export const readClinicalDerivedLayout = (record: unknown): ClinicalDerivedLayoutState => {
  const marker = isPlainObject(record) ? record[CLINICAL_DERIVED_LAYOUT_FIELD] : undefined;
  if (marker === undefined || marker === null) return { status: 'unmarked' };
  if (
    isPlainObject(marker) &&
    marker.version === CLINICAL_DERIVED_LAYOUT_VERSION &&
    isClinicalDerivedDocId(marker.generation)
  ) {
    return {
      status: 'marked',
      layout: { version: CLINICAL_DERIVED_LAYOUT_VERSION, generation: marker.generation },
    };
  }
  return { status: 'unsupported' };
};

export const meetsClinicalDerivedClientVersion = (value: unknown): boolean =>
  Number.isSafeInteger(value) &&
  (value as number) >= CLINICAL_DERIVED_MIN_CLIENT_RUNTIME_CONTRACT_VERSION;

// Same notion of an active holder as the server's duplicate_active_episode check.
const activeEpisodeIdOf = (holder: unknown): string =>
  isPlainObject(holder) && !holder.isBlocked && typeof holder.clinicalEpisodeId === 'string'
    ? holder.clinicalEpisodeId.trim()
    : '';

/**
 * Active episodes of a day (each bed patient and its clinical crib) that may own an episode
 * document: a valid id that is active only once. Ids active more than once are reported apart.
 */
export const collectClinicalDerivedEpisodes = (
  record: unknown
): { episodes: ClinicalDerivedEpisodeRef[]; duplicateEpisodeIds: string[] } => {
  const holders: ClinicalDerivedEpisodeRef[] = [];
  const counts = new Map<string, number>();
  const beds = isPlainObject(record) && isPlainObject(record.beds) ? record.beds : {};
  Object.entries(beds).forEach(([bedId, bed]) => {
    const crib = isPlainObject(bed) ? bed.clinicalCrib : undefined;
    const candidates: Array<[ClinicalDerivedTarget, unknown]> = [
      ['bed', bed],
      ['clinicalCrib', crib],
    ];
    candidates.forEach(([target, holder]) => {
      const clinicalEpisodeId = activeEpisodeIdOf(holder);
      if (!clinicalEpisodeId) return;
      counts.set(clinicalEpisodeId, (counts.get(clinicalEpisodeId) || 0) + 1);
      holders.push({ bedId, target, clinicalEpisodeId });
    });
  });
  return {
    episodes: holders.filter(
      holder =>
        counts.get(holder.clinicalEpisodeId) === 1 &&
        isClinicalDerivedDocId(holder.clinicalEpisodeId)
    ),
    duplicateEpisodeIds: [...counts]
      .filter(([, count]) => count > 1)
      .map(([clinicalEpisodeId]) => clinicalEpisodeId)
      .sort(),
  };
};

/**
 * Episode documents of the day's current layout (this date, this generation, this schema), by
 * episode id; leftovers are ignored. Callers pass documents whose id equals `clinicalEpisodeId`.
 */
const currentDocsByEpisode = (
  record: DailyRecord,
  docs: readonly ClinicalDerivedEpisodeDoc[]
): Map<string, ClinicalDerivedEpisodeDoc> => {
  const layout = readClinicalDerivedLayout(record);
  const current = new Map<string, ClinicalDerivedEpisodeDoc>();
  if (layout.status !== 'marked' || typeof record.date !== 'string') return current;
  (Array.isArray(docs) ? docs : []).forEach(doc => {
    const candidate: unknown = doc;
    if (
      isPlainObject(candidate) &&
      candidate.schemaVersion === CLINICAL_DERIVED_DOC_SCHEMA_VERSION &&
      candidate.date === record.date &&
      candidate.layoutGeneration === layout.layout.generation &&
      isClinicalDerivedDocId(candidate.clinicalEpisodeId)
    ) {
      current.set(candidate.clinicalEpisodeId, doc);
    }
  });
  return current;
};

const applyMovedFields = (holder: unknown, doc: ClinicalDerivedEpisodeDoc): PlainObject => {
  const next: PlainObject = { ...(holder as PlainObject) };
  const source = doc as unknown as PlainObject;
  CLINICAL_DERIVED_MOVED_FIELDS.forEach(field => {
    if (!hasOwn(source, field) || source[field] === undefined) return;
    if (source[field] === null) delete next[field];
    else next[field] = clonePlain(source[field]);
  });
  return next;
};

/**
 * Pure read view of a marked day. Each active episode takes the moved fields from its current
 * document, matched by episode id only (a same-day crib<->bed move keeps the id): a field the
 * document has wins even when null (null leaves it absent), a field it lacks keeps the embedded
 * copy. Ids active more than once are not overlaid. Identity, `lastUpdated` and `meta` are never
 * touched, and the input is never mutated; without a match the same record is returned.
 */
export const overlayClinicalDerived = (
  record: DailyRecord,
  docs: readonly ClinicalDerivedEpisodeDoc[]
): ClinicalDerivedOverlayResult => {
  const current = currentDocsByEpisode(record, docs);
  const result: ClinicalDerivedOverlayResult = {
    record,
    matchedEpisodeIds: [],
    skippedDuplicateEpisodeIds: [],
  };
  if (current.size === 0) return result;

  const { episodes, duplicateEpisodeIds } = collectClinicalDerivedEpisodes(record);
  const beds: PlainObject = { ...record.beds };
  episodes.forEach(({ bedId, target, clinicalEpisodeId }) => {
    const doc = current.get(clinicalEpisodeId);
    if (!doc) return;
    const bed = { ...(beds[bedId] as PlainObject) };
    if (target === 'bed') beds[bedId] = applyMovedFields(bed, doc);
    else beds[bedId] = { ...bed, clinicalCrib: applyMovedFields(bed.clinicalCrib, doc) };
    result.matchedEpisodeIds.push(clinicalEpisodeId);
  });
  result.matchedEpisodeIds.sort();
  result.skippedDuplicateEpisodeIds = duplicateEpisodeIds.filter(id => current.has(id));
  if (result.matchedEpisodeIds.length > 0) {
    result.record = { ...record, beds: beds as DailyRecord['beds'] };
  }
  return result;
};

const resolveDayRevision = (record: DailyRecord): number => {
  const meta = (record as DailyRecord & { meta?: unknown }).meta;
  const revision = Number(isPlainObject(meta) ? meta.revision : undefined);
  return Number.isFinite(revision) && revision >= 0 ? revision : 0;
};

/**
 * Current documents written by a later day revision than the day read: that day is stale and
 * both must be read again before acting on the combined view.
 */
export const findStaleClinicalDerivedEpisodeIds = (
  record: DailyRecord,
  docs: readonly ClinicalDerivedEpisodeDoc[]
): string[] => {
  const dayRevision = resolveDayRevision(record);
  return [...currentDocsByEpisode(record, docs).values()]
    .filter(doc => Number(doc.dayRevision) > dayRevision)
    .map(doc => doc.clinicalEpisodeId)
    .sort();
};
