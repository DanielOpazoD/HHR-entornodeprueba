/**
 * Shared contract for the per-episode clinical data moved out of the daily record (phase 1a,
 * docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md).
 *
 * On a marked day the moved fields of each bed patient and clinical crib live in
 * `hospitals/{hospitalId}/dailyRecords/{date}/clinicalDerived/{clinicalEpisodeId}`, one small
 * document per day and episode that only the server writes. Readers combine both with
 * `overlayClinicalDerived`.
 *
 * Plain CJS without dependencies: Cloud Functions require it directly and
 * `src/services/storage/clinicalDerivedContract.ts` mirrors it. The alignment test
 * (clinicalDerivedContractAlignment) runs the same synthetic matrix through both copies.
 */
'use strict';

const CLINICAL_DERIVED_COLLECTION = 'clinicalDerived';

/** Per-episode fields that leave the day on a marked day, in a stable order. */
const CLINICAL_DERIVED_MOVED_FIELDS = Object.freeze([
  'clinicalSyncCheckpoint',
  'vitalSignsHistory',
]);

const CLINICAL_DERIVED_TARGETS = Object.freeze(['bed', 'clinicalCrib']);

/** Root field of the day marker `{ version, generation }`; only the server sets it. */
const CLINICAL_DERIVED_LAYOUT_FIELD = 'clinicalDerivedLayout';
const CLINICAL_DERIVED_LAYOUT_VERSION = 1;
const CLINICAL_DERIVED_DOC_SCHEMA_VERSION = 1;

/**
 * Callables accept moved-field writes on marked (or marking) days only when the payload carries
 * this top-level field at or above the minimum. It stays outside digests and receipts.
 */
const CLIENT_RUNTIME_CONTRACT_VERSION_FIELD = 'clientRuntimeContractVersion';
const CLINICAL_DERIVED_MIN_CLIENT_RUNTIME_CONTRACT_VERSION = 3;

const DOC_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
// Firestore reserves ids shaped like `__x__`; the character class alone would accept them.
const RESERVED_DOC_ID_PATTERN = /^__.*__$/;

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const clonePlain = value => {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (!isPlainObject(value)) return value;
  const copy = {};
  Object.keys(value).forEach(key => {
    copy[key] = clonePlain(value[key]);
  });
  return copy;
};

/** Episode ids and layout generations double as Firestore document ids. */
const isClinicalDerivedDocId = value =>
  typeof value === 'string' && DOC_ID_PATTERN.test(value) && !RESERVED_DOC_ID_PATTERN.test(value);

const buildClinicalDerivedLayout = generation => {
  if (!isClinicalDerivedDocId(generation)) {
    throw new Error('clinicalDerived layout generation must be a valid document id.');
  }
  return { version: CLINICAL_DERIVED_LAYOUT_VERSION, generation };
};

/**
 * `unmarked` (no marker), `marked` (a v1 marker) or `unsupported` (a marker this code does not
 * understand; callers must not treat that day as unmarked).
 */
const readClinicalDerivedLayout = record => {
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

const meetsClinicalDerivedClientVersion = value =>
  Number.isSafeInteger(value) && value >= CLINICAL_DERIVED_MIN_CLIENT_RUNTIME_CONTRACT_VERSION;

// Same notion of an active holder as the server's duplicate_active_episode check.
const activeEpisodeIdOf = holder =>
  isPlainObject(holder) && !holder.isBlocked && typeof holder.clinicalEpisodeId === 'string'
    ? holder.clinicalEpisodeId.trim()
    : '';

/**
 * Active episodes of a day (each bed patient and its clinical crib) that may own an episode
 * document: a valid id that is active only once. Ids active more than once are reported apart.
 */
const collectClinicalDerivedEpisodes = record => {
  const holders = [];
  const counts = new Map();
  const beds = isPlainObject(record) && isPlainObject(record.beds) ? record.beds : {};
  Object.entries(beds).forEach(([bedId, bed]) => {
    const crib = isPlainObject(bed) ? bed.clinicalCrib : undefined;
    [
      ['bed', bed],
      ['clinicalCrib', crib],
    ].forEach(([target, holder]) => {
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

/** Episode documents of the day's current layout, by episode id; leftovers are ignored. */
const currentDocsByEpisode = (record, docs) => {
  const layout = readClinicalDerivedLayout(record);
  const current = new Map();
  if (layout.status !== 'marked') return current;
  (Array.isArray(docs) ? docs : []).forEach(doc => {
    if (
      isPlainObject(doc) &&
      doc.date === record.date &&
      doc.layoutGeneration === layout.layout.generation &&
      isClinicalDerivedDocId(doc.clinicalEpisodeId)
    ) {
      current.set(doc.clinicalEpisodeId, doc);
    }
  });
  return current;
};

const applyMovedFields = (holder, doc) => {
  const next = { ...holder };
  CLINICAL_DERIVED_MOVED_FIELDS.forEach(field => {
    if (!hasOwn(doc, field) || doc[field] === undefined) return;
    if (doc[field] === null) delete next[field];
    else next[field] = clonePlain(doc[field]);
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
const overlayClinicalDerived = (record, docs) => {
  const current = currentDocsByEpisode(record, docs);
  const result = { record, matchedEpisodeIds: [], skippedDuplicateEpisodeIds: [] };
  if (current.size === 0) return result;

  const { episodes, duplicateEpisodeIds } = collectClinicalDerivedEpisodes(record);
  const beds = { ...record.beds };
  episodes.forEach(({ bedId, target, clinicalEpisodeId }) => {
    const doc = current.get(clinicalEpisodeId);
    if (!doc) return;
    const bed = { ...beds[bedId] };
    if (target === 'bed') beds[bedId] = applyMovedFields(bed, doc);
    else beds[bedId] = { ...bed, clinicalCrib: applyMovedFields(bed.clinicalCrib, doc) };
    result.matchedEpisodeIds.push(clinicalEpisodeId);
  });
  result.matchedEpisodeIds.sort();
  result.skippedDuplicateEpisodeIds = duplicateEpisodeIds.filter(id => current.has(id));
  if (result.matchedEpisodeIds.length > 0) result.record = { ...record, beds };
  return result;
};

const resolveDayRevision = record => {
  const revision = Number(isPlainObject(record?.meta) ? record.meta.revision : undefined);
  return Number.isFinite(revision) && revision >= 0 ? revision : 0;
};

/**
 * Current documents written by a later day revision than the day read: that day is stale and
 * both must be read again before acting on the combined view.
 */
const findStaleClinicalDerivedEpisodeIds = (record, docs) => {
  const dayRevision = resolveDayRevision(record);
  return [...currentDocsByEpisode(record, docs).values()]
    .filter(doc => Number(doc.dayRevision) > dayRevision)
    .map(doc => doc.clinicalEpisodeId)
    .sort();
};

module.exports = {
  CLINICAL_DERIVED_COLLECTION,
  CLINICAL_DERIVED_MOVED_FIELDS,
  CLINICAL_DERIVED_TARGETS,
  CLINICAL_DERIVED_LAYOUT_FIELD,
  CLINICAL_DERIVED_LAYOUT_VERSION,
  CLINICAL_DERIVED_DOC_SCHEMA_VERSION,
  CLIENT_RUNTIME_CONTRACT_VERSION_FIELD,
  CLINICAL_DERIVED_MIN_CLIENT_RUNTIME_CONTRACT_VERSION,
  isClinicalDerivedDocId,
  buildClinicalDerivedLayout,
  readClinicalDerivedLayout,
  meetsClinicalDerivedClientVersion,
  collectClinicalDerivedEpisodes,
  overlayClinicalDerived,
  findStaleClinicalDerivedEpisodeIds,
};
