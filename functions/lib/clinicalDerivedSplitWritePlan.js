/**
 * Split-write transaction helpers for phase 1a clinicalDerived persistence
 * (docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md: D2, D4, D8, D11 and D14).
 */
'use strict';

const { isDeepStrictEqual } = require('node:util');
const { assertPersistedDocumentSize, digestValue } = require('./rayenClinicalEnrichmentPolicy');
const {
  clonePlainValue,
  embedsMovedField,
  hasOwn,
  holderKey,
  holderOf,
  holderPath,
  isPlainObject,
  mapHolders,
  movedValues,
  splittableHolders,
  withMovedFieldsOf,
} = require('./clinicalDerivedHolders');
const {
  CLINICAL_DERIVED_COLLECTION,
  CLINICAL_DERIVED_DOC_SCHEMA_VERSION,
  CLINICAL_DERIVED_LAYOUT_FIELD,
  CLINICAL_DERIVED_MOVED_FIELDS,
  overlayClinicalDerived,
} = require('./clinicalDerivedContract');

/** Root field of a run's history copy: each split episode's moved fields before the run (D11). */
const CLINICAL_DERIVED_PREVIOUS_FIELD = 'clinicalDerivedPrevious';
/** History copy of an episode document a split write replaces while it does not count (D14). */
const CLINICAL_DERIVED_DISPLACED_REASON = 'clinical_derived_displaced';

const episodeDocRef = (dayRef, clinicalEpisodeId) =>
  dayRef.collection(CLINICAL_DERIVED_COLLECTION).doc(clinicalEpisodeId);

/** Episode documents of any generation by id (null when missing), read in the transaction. */
const readEpisodeDocs = async ({ get, dayRef, episodeIds }) => {
  const ids = [...new Set(episodeIds)].sort();
  const snapshots = await Promise.all(ids.map(id => get(episodeDocRef(dayRef, id))));
  return new Map(
    ids.map((id, index) => [id, snapshots[index]?.exists ? snapshots[index].data() || {} : null])
  );
};

/**
 * Read documents of the written episodes that the overlay (D4) would not use on this layout: a
 * deleted day's leftover, or any other generation, date or schema. Their id is the episode, not
 * the generation, so the split write `set`s over them.
 */
const displacedDocsOf = ({ docs, episodes, date, layout }) =>
  episodes
    .map(({ clinicalEpisodeId }) => ({ clinicalEpisodeId, doc: docs.get(clinicalEpisodeId) }))
    .filter(
      ({ clinicalEpisodeId, doc }) =>
        doc &&
        !(
          doc.schemaVersion === CLINICAL_DERIVED_DOC_SCHEMA_VERSION &&
          doc.clinicalEpisodeId === clinicalEpisodeId &&
          doc.date === date &&
          doc.layoutGeneration === layout?.generation
        )
    );

/**
 * D14: the transaction keeps each displaced document whole in the day's history before replacing
 * it. The copy's id derives from the document's content, so a retried transaction writes the same
 * copy and two different documents never share one.
 */
const displacedCopyWrites = ({ dayRef, displaced, now }) =>
  displaced.map(({ clinicalEpisodeId, doc }) => {
    const data = {
      snapshotReason: CLINICAL_DERIVED_DISPLACED_REASON,
      snapshotTimestamp: now,
      [CLINICAL_DERIVED_PREVIOUS_FIELD]: {
        [clinicalEpisodeId]: { document: clonePlainValue(doc) },
      },
    };
    assertPersistedDocumentSize(data);
    const id = `clinical-derived-${clinicalEpisodeId}-${digestValue(doc).slice(0, 24)}`;
    return { ref: dayRef.collection('history').doc(id), data };
  });

/** D4 view; a day this write marks has no current documents yet, so it stays as read. */
const combinedView = (record, docsById) =>
  overlayClinicalDerived(
    record,
    [...docsById].filter(([id, doc]) => doc && doc.clinicalEpisodeId === id).map(([, doc]) => doc)
  );

/**
 * D11 entry of one episode: its document of any generation (a deleted day's leftover included)
 * and, when there is none or the day still embeds a copy, the embedded copy this write deletes.
 */
const previousEntry = (doc, remoteHolder) => ({
  ...(doc
    ? {
        document: {
          layoutGeneration: doc.layoutGeneration ?? null,
          date: doc.date ?? null,
          ...movedValues(doc),
        },
      }
    : {}),
  ...(!doc || embedsMovedField(remoteHolder) ? { embedded: movedValues(remoteHolder) } : {}),
});

/**
 * Writes shared by the patch and the batch: the history copy of each displaced document (D14),
 * each split episode's full document (D2) with the day revision of this transaction, the marker
 * when this write marks the day, and the run copy (D11).
 */
const buildSplitWrite = ({
  state,
  dayRef,
  date,
  remoteData,
  docs,
  displaced,
  episodes,
  valuesOf,
  record,
  deleteField,
}) => {
  const docWrites = ({ now, mutationId }) => [
    ...displacedCopyWrites({ dayRef, displaced, now }),
    ...episodes.map(episode => {
      const data = {
        schemaVersion: CLINICAL_DERIVED_DOC_SCHEMA_VERSION,
        date,
        clinicalEpisodeId: episode.clinicalEpisodeId,
        layoutGeneration: state.layout.generation,
        target: episode.target,
        bedId: episode.bedId,
        dayRevision: record.meta.revision,
        updatedAt: now,
        lastMutationId: mutationId || null,
        ...movedValues(valuesOf(episode)),
      };
      assertPersistedDocumentSize(data);
      return { ref: episodeDocRef(dayRef, episode.clinicalEpisodeId), data };
    }),
  ];
  const previous = Object.fromEntries(
    episodes.map(({ clinicalEpisodeId, bedId, target }) => [
      clinicalEpisodeId,
      previousEntry(docs.get(clinicalEpisodeId), holderOf(remoteData, bedId, target)),
    ])
  );
  const splitKeys = new Set(episodes.map(({ bedId, target }) => holderKey(bedId, target)));
  return {
    marker: state.status === 'marking' ? { [CLINICAL_DERIVED_LAYOUT_FIELD]: state.layout } : {},
    docWrites,
    /**
     * A run copy created by this write carries every split episode. Their embedded values move from
     * the copy's beds into `clinicalDerivedPrevious` instead of being duplicated, so the copy never
     * outweighs the full copy written before the split; the 900 KB check still applies.
     */
    withRunPrevious: copy => {
      const data = {
        ...mapHolders(copy, (holder, bedId, target) =>
          splitKeys.has(holderKey(bedId, target)) ? withMovedFieldsOf(holder, null) : holder
        ),
        [CLINICAL_DERIVED_PREVIOUS_FIELD]: previous,
      };
      assertPersistedDocumentSize(data);
      return data;
    },
    /**
     * An existing run copy only gains the episodes it lacks: the run's first value wins. A moved
     * value the copy's beds hold for such an episode, equal to the embedded one this write deletes,
     * leaves the beds as in `withRunPrevious`; a different one is what the run found, and stays.
     */
    extendRunCopy: ({ transaction, ref, snapshot }) => {
      const existing = snapshot?.data?.() || {};
      const prior = existing[CLINICAL_DERIVED_PREVIOUS_FIELD];
      const recorded = { ...(isPlainObject(prior) ? prior : {}) };
      const inCopy = new Map(
        [...splittableHolders(existing).values()].map(at => [at.clinicalEpisodeId, at])
      );
      const update = {};
      const leaving = new Set();
      Object.keys(previous)
        .filter(id => !hasOwn(recorded, id))
        .forEach(id => {
          recorded[id] = previous[id];
          update[`${CLINICAL_DERIVED_PREVIOUS_FIELD}.${id}`] = previous[id];
          const at = inCopy.get(id);
          const holder = at ? holderOf(existing, at.bedId, at.target) : undefined;
          CLINICAL_DERIVED_MOVED_FIELDS.filter(
            field =>
              holder?.[field] !== undefined &&
              isDeepStrictEqual(holder[field], previous[id].embedded?.[field])
          ).forEach(field => {
            update[`${holderPath(at.bedId, at.target)}.${field}`] = deleteField();
            leaving.add(`${holderKey(at.bedId, at.target)}|${field}`);
          });
        });
      if (Object.keys(update).length === 0) return;
      assertPersistedDocumentSize({
        ...mapHolders(existing, (holder, bedId, target) =>
          Object.fromEntries(
            Object.entries(holder).filter(
              ([field]) => !leaving.has(`${holderKey(bedId, target)}|${field}`)
            )
          )
        ),
        [CLINICAL_DERIVED_PREVIOUS_FIELD]: recorded,
      });
      transaction.update(ref, update);
    },
  };
};

/** Split counters for functionsTelemetry: an enum and counts, never ids, beds or values. */
const splitTelemetry = ({ state, splitEpisodes, embeddedEpisodes, view, displaced }) => ({
  clinicalDerivedLayout: state.status,
  clinicalDerivedSplitEpisodes: splitEpisodes,
  clinicalDerivedEmbeddedEpisodes: embeddedEpisodes,
  clinicalDerivedOverlaidEpisodes: view.matchedEpisodeIds.length,
  clinicalDerivedDisplacedDocs: displaced.length,
});

module.exports = {
  CLINICAL_DERIVED_DISPLACED_REASON,
  CLINICAL_DERIVED_PREVIOUS_FIELD,
  buildSplitWrite,
  combinedView,
  displacedDocsOf,
  episodeDocRef,
  readEpisodeDocs,
  splitTelemetry,
};
