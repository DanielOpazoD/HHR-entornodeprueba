/**
 * Server side of the per-episode clinical data split (phase 1a,
 * docs/DESIGN_DAILY_RECORD_PHASE1_CLINICAL_DERIVED.md: D5-D8 and D11).
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
 * - keeps in the run's history copy what each episode had before the run first wrote it (D11).
 */
'use strict';

const crypto = require('node:crypto');
const functions = require('firebase-functions/v1');
const { movementRestoreRecord } = require('./movementRestoreSources');
const { assertPersistedDocumentSize } = require('./rayenClinicalEnrichmentPolicy');
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
const CLINICAL_DERIVED_CLIENT_OUTDATED = 'clinical_derived_client_outdated';
const CLINICAL_DERIVED_LAYOUT_UNSUPPORTED = 'clinical_derived_layout_unsupported';
const CLINICAL_DERIVED_FIELD_CONTRACT_UNSUPPORTED = 'clinical_derived_field_contract_unsupported';

const MOVED_FIELDS = new Set(CLINICAL_DERIVED_MOVED_FIELDS);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

const clonePlainValue = value => {
  if (Array.isArray(value)) return value.map(clonePlainValue);
  if (value instanceof Date || typeof value?.toDate === 'function') return value;
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, clonePlainValue(nested)])
    );
  }
  return value;
};

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

const failedPrecondition = (reason, message) =>
  new functions.https.HttpsError('failed-precondition', `${reason}: ${message}`);

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

/** Runs after the idempotency classification, so a confirmed retry never reaches it. */
const assertSplitWriteAccepted = ({ state, data, fieldContractVersion }) => {
  if (state.status === 'unsupported') {
    throw failedPrecondition(
      CLINICAL_DERIVED_LAYOUT_UNSUPPORTED,
      'this day uses a clinical data layout this server does not support.'
    );
  }
  // D7: the published minimum client version is only advice; this per-request check is the fence.
  if (!meetsClinicalDerivedClientVersion(data?.[CLIENT_RUNTIME_CONTRACT_VERSION_FIELD])) {
    throw failedPrecondition(
      CLINICAL_DERIVED_CLIENT_OUTDATED,
      'reload the app before writing clinical data on this day.'
    );
  }
  // The v1 recursive merge would need the combined value as its base; v3 clients send v2.
  if (fieldContractVersion === 1) {
    throw failedPrecondition(
      CLINICAL_DERIVED_FIELD_CONTRACT_UNSUPPORTED,
      'moved clinical fields require the canonical field contract.'
    );
  }
};

const holderKey = (bedId, target) => `${bedId}|${target}`;

const holderOf = (record, bedId, target) => {
  const bed = isPlainObject(record?.beds) ? record.beds[bedId] : undefined;
  const holder = target === 'bed' ? bed : isPlainObject(bed) ? bed.clinicalCrib : undefined;
  return isPlainObject(holder) ? holder : undefined;
};

/** Copy of `record` with `settle(holder, bedId, target)` applied to every bed and clinical crib. */
const mapHolders = (record, settle) => {
  if (!isPlainObject(record?.beds)) return record;
  const beds = {};
  Object.entries(record.beds).forEach(([bedId, bed]) => {
    if (!isPlainObject(bed)) {
      beds[bedId] = bed;
      return;
    }
    const next = settle(bed, bedId, 'bed');
    beds[bedId] = isPlainObject(bed.clinicalCrib)
      ? { ...next, clinicalCrib: settle(bed.clinicalCrib, bedId, 'clinicalCrib') }
      : next;
  });
  return { ...record, beds };
};

/** Copy of `holder` whose moved fields are those of `source`; absent there, absent here. */
const withMovedFieldsOf = (holder, source) => {
  const next = { ...holder };
  CLINICAL_DERIVED_MOVED_FIELDS.forEach(field => {
    if (isPlainObject(source) && hasOwn(source, field))
      next[field] = clonePlainValue(source[field]);
    else delete next[field];
  });
  return next;
};

/** Both moved fields, always present: null stands for "no value" (D2). */
const movedValues = holder =>
  Object.fromEntries(
    CLINICAL_DERIVED_MOVED_FIELDS.map(field => [
      field,
      isPlainObject(holder) && holder[field] !== undefined ? clonePlainValue(holder[field]) : null,
    ])
  );

const embedsMovedField = holder =>
  isPlainObject(holder) && CLINICAL_DERIVED_MOVED_FIELDS.some(field => holder[field] !== undefined);

/** Holders that may own an episode document: a valid id active only once in the day. */
const splittableHolders = record =>
  new Map(
    collectClinicalDerivedEpisodes(record).episodes.map(episode => [
      holderKey(episode.bedId, episode.target),
      episode,
    ])
  );

/** `beds.<bedId>[.clinicalCrib].<moved field>[...]`, else null. */
const parseMovedFieldPath = path => {
  const parts = String(path)
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);
  if (parts[0] !== 'beds' || !parts[1]) return null;
  const target = parts[2] === 'clinicalCrib' ? 'clinicalCrib' : 'bed';
  const fieldIndex = target === 'bed' ? 2 : 3;
  if (!MOVED_FIELDS.has(parts[fieldIndex])) return null;
  return {
    key: holderKey(parts[1], target),
    field: parts[fieldIndex],
    whole: parts.length === fieldIndex + 1,
  };
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
 * Writes shared by the patch and the batch: each split episode's full document (D2) with the day
 * revision of this transaction, the marker when this write marks the day, and the run copy (D11).
 */
const buildSplitWrite = ({ state, dayRef, date, remoteData, docs, episodes, valuesOf, record }) => {
  const docWrites = ({ now, mutationId }) =>
    episodes.map(episode => {
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
    });
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
    /** An existing run copy only gains the episodes it lacks: the run's first value wins. */
    extendRunCopy: ({ transaction, ref, snapshot }) => {
      const existing = snapshot?.data?.() || {};
      const recorded = isPlainObject(existing[CLINICAL_DERIVED_PREVIOUS_FIELD])
        ? existing[CLINICAL_DERIVED_PREVIOUS_FIELD]
        : {};
      const missing = Object.keys(previous).filter(id => !hasOwn(recorded, id));
      if (missing.length === 0) return;
      const added = Object.fromEntries(missing.map(id => [id, previous[id]]));
      assertPersistedDocumentSize({
        ...existing,
        [CLINICAL_DERIVED_PREVIOUS_FIELD]: { ...recorded, ...added },
      });
      transaction.update(
        ref,
        Object.fromEntries(
          missing.map(id => [`${CLINICAL_DERIVED_PREVIOUS_FIELD}.${id}`, added[id]])
        )
      );
    },
  };
};

/** Split counters for functionsTelemetry: an enum and counts, never ids, beds or values. */
const splitTelemetry = ({ state, splitEpisodes, embeddedEpisodes, view }) => ({
  clinicalDerivedLayout: state.status,
  clinicalDerivedSplitEpisodes: splitEpisodes,
  clinicalDerivedEmbeddedEpisodes: embeddedEpisodes,
  clinicalDerivedOverlaidEpisodes: view.matchedEpisodeIds.length,
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
      // Authorization never lets a partial moved-field path through; fail closed if it ever does.
      throw failedPrecondition(
        CLINICAL_DERIVED_LAYOUT_UNSUPPORTED,
        'a moved clinical field can only be written whole.'
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

    const plan = ({ patchedRecord, now, mutationId }) => {
      const write = buildSplitWrite({
        state,
        dayRef,
        date,
        remoteData,
        docs,
        episodes,
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
            const prefix = target === 'bed' ? `beds.${bedId}` : `beds.${bedId}.clinicalCrib`;
            CLINICAL_DERIVED_MOVED_FIELDS.forEach(field => {
              txnUpdate[`${prefix}.${field}`] = deleteField();
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
      }),
      plan,
    };
  };

  /**
   * Clinical batch. Null unless a target writes a moved field on a marked day or on a day the batch
   * marks. Reads the targets' documents right after the day; `assertAccepted` runs after the
   * idempotency classification.
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

    const finalize = ({ record, now }) => {
      const write = buildSplitWrite({
        state,
        dayRef,
        date: payload.date,
        remoteData,
        docs,
        episodes,
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
      }),
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
 * split write. An existing marked day keeps the remote marker and takes the moved fields of every
 * episode from the remote by episode id only (a crib<->bed move keeps the id), with or without the
 * fence. An existing unmarked day is never marked.
 */
const settleClinicalDerivedFullSave = ({ snapshotExists, remoteData, incoming, record, date }) => {
  const next = { ...record };
  delete next[CLINICAL_DERIVED_LAYOUT_FIELD];
  if (!snapshotExists) {
    if (!isClinicalDerivedSplitDate(date)) return { record: next, telemetry: null };
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
  createClinicalDerivedStore,
  isClinicalDerivedSplitDate,
  readClinicalDerivedSplitFrom,
  readPriorDayForCarryover,
  settleClinicalDerivedFullSave,
};
