/**
 * Server side of the per-episode clinical data split (phase 1a,
 * docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md: D5-D8, D11 and D14).
 *
 * The three authority callables only call in here. While no day carries the marker and
 * `HHR_CLINICAL_DERIVED_SPLIT_FROM` is unset every entry point returns null, or the record without
 * a client-sent marker, so nothing else changes until the owner turns the switch on.
 *
 * On a split write (moved fields on a marked day, or on a day this write marks) the server:
 * - reads the written episodes' documents before the transaction's first write;
 * - compares and applies on the combined view (`overlayClinicalDerived`, D4);
 * - persists the day as the remote plus its change, without the written episodes' moved fields,
 *   and each written episode's document in full with `set`;
 * - first keeps in the day's history, whole, a written episode's document that does not count for
 *   the day, such as a deleted day's leftover (D14);
 * - keeps in the run's history copy what each episode had before the run first wrote it (D11).
 */
'use strict';

const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const functions = require('firebase-functions/v1');
const { movementRestoreRecord } = require('./movementRestoreSources');
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
  parseMovedFieldPath,
  splittableHolders,
  withMovedFieldsOf,
} = require('./clinicalDerivedHolders');
const {
  CLINICAL_DERIVED_COLLECTION,
  CLINICAL_DERIVED_DOC_SCHEMA_VERSION,
  CLINICAL_DERIVED_LAYOUT_FIELD,
  CLINICAL_DERIVED_MOVED_FIELDS,
  CLIENT_RUNTIME_CONTRACT_VERSION_FIELD,
  buildClinicalDerivedLayout,
  collectClinicalDerivedEpisodes,
  isClinicalDerivedDocId,
  meetsClinicalDerivedClientVersion,
  overlayClinicalDerived,
  readClinicalDerivedLayout,
} = require('./clinicalDerivedContract');

const CLINICAL_DERIVED_SPLIT_FROM_ENV = 'HHR_CLINICAL_DERIVED_SPLIT_FROM';
/** Root field of a run's history copy: each split episode's moved fields before the run (D11). */
const CLINICAL_DERIVED_PREVIOUS_FIELD = 'clinicalDerivedPrevious';
/** History copy of an episode document a split write replaces while it does not count (D14). */
const CLINICAL_DERIVED_DISPLACED_REASON = 'clinical_derived_displaced';
const CLINICAL_DERIVED_CLIENT_OUTDATED = 'clinical_derived_client_outdated';
const CLINICAL_DERIVED_LAYOUT_UNSUPPORTED = 'clinical_derived_layout_unsupported';
const CLINICAL_DERIVED_FIELD_CONTRACT_UNSUPPORTED = 'clinical_derived_field_contract_unsupported';
const CLINICAL_DERIVED_PARTIAL_PATH_UNSUPPORTED = 'clinical_derived_partial_path_unsupported';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const isIsoCalendarDay = value => {
  if (typeof value !== 'string' || !ISO_DAY.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
};

/** D5: start date of the split, read on every call. Anything but a strict date leaves it off. */
const readClinicalDerivedSplitFrom = () => {
  const value = process.env[CLINICAL_DERIVED_SPLIT_FROM_ENV];
  return isIsoCalendarDay(value) ? value : null;
};

/** Decided by the target date, never by the run's authority or source date. */
const isClinicalDerivedSplitDate = date => {
  const from = readClinicalDerivedSplitFrom();
  return from !== null && isIsoCalendarDay(date) && date >= from;
};

/** Day carries a marker, supported or not: its writes follow the split layout, never the switch. */
const isClinicalDerivedSplitDay = record => readClinicalDerivedLayout(record).status !== 'unmarked';

const failedPrecondition = (reason, message) => {
  const error = new functions.https.HttpsError('failed-precondition', `${reason}: ${message}`);
  // Closed enum for functionsTelemetry (e.g. `client_outdated`); the message never goes there.
  error.clinicalDerivedRejection = reason.replace(/^clinical_derived_/, '');
  return error;
};

const freshLayout = () => buildClinicalDerivedLayout(crypto.randomUUID());

/**
 * Layout a moved-field write applies to its target day: the day's own marker (`marked`), a fresh
 * one when this write marks the day (`marking`: unmarked and dated on or after the start), a
 * marker this code does not understand (`unsupported`), or null: embedded, as before the split.
 */
const resolveWriteLayout = ({ record, date }) => {
  const current = readClinicalDerivedLayout(record);
  if (current.status === 'marked') return { status: 'marked', layout: current.layout };
  if (current.status === 'unsupported') return { status: 'unsupported', layout: null };
  return isClinicalDerivedSplitDate(date) ? { status: 'marking', layout: freshLayout() } : null;
};

const assertLayoutSupported = state => {
  if (state.status === 'unsupported') {
    throw failedPrecondition(
      CLINICAL_DERIVED_LAYOUT_UNSUPPORTED,
      'this day uses a clinical data layout this server does not support.'
    );
  }
};

// D7: the published minimum client version is only advice; this per-request check is the fence.
const assertClientVersion = data => {
  if (!meetsClinicalDerivedClientVersion(data?.[CLIENT_RUNTIME_CONTRACT_VERSION_FIELD])) {
    throw failedPrecondition(
      CLINICAL_DERIVED_CLIENT_OUTDATED,
      'reload the app before writing clinical data on this day.'
    );
  }
};

/** Runs after the idempotency classification, so a confirmed retry never reaches it. */
const assertSplitWriteAccepted = ({ state, data, fieldContractVersion }) => {
  assertLayoutSupported(state);
  assertClientVersion(data);
  // The v1 recursive merge would need the combined value as its base; v3 clients send v2.
  if (fieldContractVersion === 1) {
    throw failedPrecondition(
      CLINICAL_DERIVED_FIELD_CONTRACT_UNSUPPORTED,
      'moved clinical fields require the canonical field contract.'
    );
  }
};

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

const createClinicalDerivedStore = ({ FieldValue } = {}) => {
  const deleteField = () => {
    if (typeof FieldValue?.delete !== 'function') {
      throw new Error('clinicalDerived split writes require FieldValue from the factory.');
    }
    return FieldValue.delete();
  };

  /**
   * Guarded patch (Rayen fill in `off` and `shadow`). Null unless the patch writes a moved field on
   * a marked day or on a day it marks. Call after the idempotency check and before any write.
   */
  const preparePatchSplit = async ({ transaction, dayRef, date, remoteData, patch, data }) => {
    const writes = Object.keys(patch)
      .map(path => ({ path, moved: parseMovedFieldPath(path) }))
      .filter(write => write.moved);
    if (writes.length === 0) return null;
    const state = resolveWriteLayout({ record: remoteData, date });
    if (!state) return null;
    assertSplitWriteAccepted({ state, data });
    if (writes.some(({ moved }) => !moved.whole)) {
      // Unreachable today: guarded patches take whole fields, and other paths to these fields need
      // the schema-v2 fence, which refuses them. Fail closed with its own reason if that changes.
      throw failedPrecondition(
        CLINICAL_DERIVED_PARTIAL_PATH_UNSUPPORTED,
        'a moved clinical field can only be written whole on this day.'
      );
    }

    const holders = splittableHolders(remoteData);
    const writtenKeys = new Set(writes.map(({ moved }) => moved.key));
    const episodes = [...writtenKeys].map(key => holders.get(key)).filter(Boolean);
    const splitKeys = new Set(episodes.map(({ bedId, target }) => holderKey(bedId, target)));
    const patchedFields = new Set(writes.map(({ moved }) => `${moved.key}|${moved.field}`));
    const docs = await readEpisodeDocs({
      get: reference => transaction.get(reference),
      dayRef,
      episodeIds: episodes.map(episode => episode.clinicalEpisodeId),
    });
    const view = combinedView(remoteData, docs);
    const displaced = displacedDocsOf({ docs, episodes, date, layout: state.layout });

    const plan = ({ patchedRecord, now, mutationId }) => {
      const write = buildSplitWrite({
        state,
        dayRef,
        date,
        remoteData,
        docs,
        displaced,
        episodes,
        deleteField,
        record: patchedRecord,
        // The patched field takes its new value; the other one keeps the combined value.
        valuesOf: ({ bedId, target }) =>
          Object.fromEntries(
            CLINICAL_DERIVED_MOVED_FIELDS.map(field => [
              field,
              holderOf(
                patchedFields.has(`${holderKey(bedId, target)}|${field}`)
                  ? patchedRecord
                  : view.record,
                bedId,
                target
              )?.[field],
            ])
          ),
      });
      const docWrites = write.docWrites({ now, mutationId });
      return {
        ...write,
        // D8: the day exactly as this update leaves it.
        persistedRecord: {
          ...mapHolders(patchedRecord, (holder, bedId, target) =>
            splitKeys.has(holderKey(bedId, target)) ? withMovedFieldsOf(holder, null) : holder
          ),
          ...write.marker,
        },
        /** Moves the split paths out of the day update and writes the episode documents. */
        apply: (txn, txnUpdate) => {
          writes
            .filter(({ moved }) => splitKeys.has(moved.key))
            .forEach(({ path }) => delete txnUpdate[path]);
          episodes.forEach(({ bedId, target }) => {
            CLINICAL_DERIVED_MOVED_FIELDS.forEach(field => {
              txnUpdate[`${holderPath(bedId, target)}.${field}`] = deleteField();
            });
          });
          Object.assign(txnUpdate, write.marker);
          docWrites.forEach(({ ref, data: docData }) => txn.set(ref, docData));
        },
      };
    };

    return {
      telemetry: splitTelemetry({
        state,
        splitEpisodes: episodes.length,
        embeddedEpisodes: writtenKeys.size - episodes.length,
        view,
        displaced,
      }),
      plan,
    };
  };

  /**
   * Clinical batch. Null unless a target writes a moved field on a marked day or on a day the batch
   * marks. Reads the targets' documents right after the day. After the idempotency classification
   * `assertSupported` fails closed on an unknown marker; `assertAccepted` (D7) runs after the
   * canonical no-op, so a request that writes nothing is never fenced.
   */
  const prepareBatchSplit = async ({ get, dayRef, remoteData, payload }) => {
    const movedKeys = new Set(
      payload.targets
        .filter(target => CLINICAL_DERIVED_MOVED_FIELDS.some(field => hasOwn(target.fields, field)))
        .map(target => holderKey(target.bedId, target.clinicalCrib ? 'clinicalCrib' : 'bed'))
    );
    if (movedKeys.size === 0) return null;
    const state = resolveWriteLayout({ record: remoteData, date: payload.date });
    if (!state) return null;

    const holders = splittableHolders(remoteData);
    const episodes = state.layout
      ? [...movedKeys].map(key => holders.get(key)).filter(Boolean)
      : [];
    const splitKeys = new Set(episodes.map(({ bedId, target }) => holderKey(bedId, target)));
    const docs = await readEpisodeDocs({
      get,
      dayRef,
      episodeIds: episodes.map(episode => episode.clinicalEpisodeId),
    });
    const view = combinedView(remoteData, docs);
    const displaced = displacedDocsOf({ docs, episodes, date: payload.date, layout: state.layout });

    const finalize = ({ record, now }) => {
      const write = buildSplitWrite({
        state,
        dayRef,
        date: payload.date,
        remoteData,
        docs,
        displaced,
        episodes,
        deleteField,
        record,
        valuesOf: ({ bedId, target }) => holderOf(record, bedId, target),
      });
      const docWrites = write.docWrites({ now, mutationId: payload.mutationId });
      // The remote's moved fields everywhere except on the targets that write them: split ones
      // lose them and ones that cannot own a document keep the new embedded value.
      const persisted = mapHolders(record, (holder, bedId, target) => {
        const key = holderKey(bedId, target);
        if (movedKeys.has(key) && !splitKeys.has(key)) return holder;
        return withMovedFieldsOf(
          holder,
          splitKeys.has(key) ? null : holderOf(remoteData, bedId, target)
        );
      });
      return {
        ...write,
        persistedRecord: { ...persisted, ...write.marker },
        writeDocs: transaction => docWrites.forEach(({ ref, data }) => transaction.set(ref, data)),
      };
    };

    return {
      view: view.record,
      telemetry: splitTelemetry({
        state,
        splitEpisodes: episodes.length,
        embeddedEpisodes: movedKeys.size - episodes.length,
        view,
        displaced,
      }),
      assertSupported: () => assertLayoutSupported(state),
      assertAccepted: data =>
        assertSplitWriteAccepted({
          state,
          data,
          fieldContractVersion: payload.fieldContractVersion,
        }),
      finalize,
    };
  };

  return { preparePatchSplit, prepareBatchSplit };
};

const remoteHoldersByEpisode = (remoteData, incoming) => {
  const byEpisode = new Map();
  // Same sources as preserveRayenClinicalFields (a restored movement, then the live census).
  [movementRestoreRecord(remoteData, incoming), remoteData].forEach(source => {
    Object.values(isPlainObject(source?.beds) ? source.beds : {}).forEach(bed => {
      [bed, isPlainObject(bed) ? bed.clinicalCrib : undefined].forEach(holder => {
        const id = isPlainObject(holder) ? String(holder.clinicalEpisodeId ?? '').trim() : '';
        if (isClinicalDerivedDocId(id)) byEpisode.set(id, holder);
      });
    });
  });
  return byEpisode;
};

/**
 * Full save (D3, D5). A client marker never counts. A day created on or after the start gets a
 * fresh marker and no episode documents: what it seeds stays embedded until each episode's first
 * split write, and it keeps a client's own moved fields only from a current client (D7; with the
 * Rayen fence they are the server's carryover instead). An existing marked day keeps the remote
 * marker and takes the moved fields of every episode from the remote by episode id only (a
 * crib<->bed move keeps the id), with or without the fence. An existing unmarked day is never
 * marked. Runs after the idempotency check.
 */
const settleClinicalDerivedFullSave = ({
  snapshotExists,
  remoteData,
  incoming,
  record,
  date,
  data,
  keepsClientMovedFields,
}) => {
  const next = { ...record };
  delete next[CLINICAL_DERIVED_LAYOUT_FIELD];
  if (!snapshotExists) {
    if (!isClinicalDerivedSplitDate(date)) return { record: next, telemetry: null };
    const beds = Object.values(isPlainObject(next.beds) ? next.beds : {});
    if (
      keepsClientMovedFields &&
      beds.some(bed => embedsMovedField(bed) || embedsMovedField(bed?.clinicalCrib))
    ) {
      assertClientVersion(data);
    }
    next[CLINICAL_DERIVED_LAYOUT_FIELD] = freshLayout();
    return { record: next, telemetry: { clinicalDerivedLayout: 'marking' } };
  }
  const layout = readClinicalDerivedLayout(remoteData);
  if (layout.status === 'unmarked') return { record: next, telemetry: null };

  const remoteHolders = remoteHoldersByEpisode(remoteData, incoming);
  let preservedEpisodes = 0;
  const settled = mapHolders(next, holder => {
    const id = String(holder.clinicalEpisodeId ?? '').trim();
    // Holders that cannot own a document keep the established (embedded) result.
    if (!isClinicalDerivedDocId(id)) return holder;
    preservedEpisodes += 1;
    return withMovedFieldsOf(holder, remoteHolders.get(id));
  });
  return {
    record: {
      ...settled,
      [CLINICAL_DERIVED_LAYOUT_FIELD]: clonePlainValue(remoteData[CLINICAL_DERIVED_LAYOUT_FIELD]),
    },
    telemetry: {
      clinicalDerivedLayout: layout.status,
      clinicalDerivedPreservedEpisodes: preservedEpisodes,
    },
  };
};

/**
 * Creation: the prior day as the trusted carryover must see it, with its documents overlaid when
 * it is marked. Read before the first write of the transaction.
 */
const readPriorDayForCarryover = async ({ transaction, priorRef, priorData }) => {
  const layout = readClinicalDerivedLayout(priorData);
  if (layout.status === 'unmarked') return priorData;
  if (layout.status === 'unsupported') {
    throw failedPrecondition(
      CLINICAL_DERIVED_LAYOUT_UNSUPPORTED,
      'the previous day uses a clinical data layout this server does not support.'
    );
  }
  const docs = await readEpisodeDocs({
    get: reference => transaction.get(reference),
    dayRef: priorRef,
    episodeIds: collectClinicalDerivedEpisodes(priorData).episodes.map(
      episode => episode.clinicalEpisodeId
    ),
  });
  return combinedView(priorData, docs).record;
};

module.exports = {
  CLINICAL_DERIVED_SPLIT_FROM_ENV,
  CLINICAL_DERIVED_PREVIOUS_FIELD,
  CLINICAL_DERIVED_CLIENT_OUTDATED,
  CLINICAL_DERIVED_LAYOUT_UNSUPPORTED,
  CLINICAL_DERIVED_FIELD_CONTRACT_UNSUPPORTED,
  CLINICAL_DERIVED_PARTIAL_PATH_UNSUPPORTED,
  createClinicalDerivedStore,
  isClinicalDerivedSplitDate,
  isClinicalDerivedSplitDay,
  readClinicalDerivedSplitFrom,
  readPriorDayForCarryover,
  settleClinicalDerivedFullSave,
};
