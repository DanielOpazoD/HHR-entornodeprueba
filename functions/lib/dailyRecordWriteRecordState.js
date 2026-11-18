// The record an authority write persists and returns: patch application, meta, history snapshot.
const functions = require('firebase-functions/v1');
const { resolveCurrentRevision, toIsoTimestamp } = require('./dailyRecordWriteVersionGuards');
const { CLINICAL_DERIVED_MOVED_FIELDS } = require('./clinicalDerivedContract');
const {
  FORBIDDEN_PATCH_PATH_SEGMENTS,
  isPlainObject,
  normalizeShortString,
} = require('./dailyRecordWriteRequest');

const clonePlainValue = value => {
  if (Array.isArray(value)) {
    return value.map(clonePlainValue);
  }

  if (value instanceof Date || typeof value?.toDate === 'function') {
    return value;
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, clonePlainValue(nestedValue)])
    );
  }

  return value;
};

const setValueAtPath = (target, path, value) => {
  const parts = String(path)
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Daily record patch paths must be non-empty dot paths.'
    );
  }
  if (parts.some(part => FORBIDDEN_PATCH_PATH_SEGMENTS.has(part))) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Daily record patch path contains a forbidden segment.'
    );
  }

  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }

  cursor[parts[parts.length - 1]] = value === undefined ? null : clonePlainValue(value);
};

const applyPatchToRecord = ({ date, remoteData, patch }) => {
  const record = clonePlainValue(remoteData || {});
  Object.entries(patch).forEach(([path, value]) => setValueAtPath(record, path, value));
  record.date = date;
  return record;
};

// Campos derivados/históricos por cama que inflan el registro (~17KB, ~13KB y
// ~7,5KB por cama medidos): duplicarlos en cada snapshot de historial es
// cuadrático y no aporta a la auditoría del censo (viven en el registro vigente
// y/o son historiales por sí mismos).
// The first two are the fields phase 1a moves out of the day (clinicalDerivedContract).
const HEAVY_DERIVED_BED_FIELDS = [...CLINICAL_DERIVED_MOVED_FIELDS, 'evaluationScores'];

const slimHistoryBed = bed => {
  if (!bed || typeof bed !== 'object' || Array.isArray(bed)) {
    return bed;
  }
  const copy = { ...bed };
  HEAVY_DERIVED_BED_FIELDS.forEach(field => {
    delete copy[field];
  });
  if (
    copy.clinicalCrib &&
    typeof copy.clinicalCrib === 'object' &&
    !Array.isArray(copy.clinicalCrib)
  ) {
    const crib = { ...copy.clinicalCrib };
    HEAVY_DERIVED_BED_FIELDS.forEach(field => {
      delete crib[field];
    });
    copy.clinicalCrib = crib;
  }
  return copy;
};

/**
 * Snapshot de historial adelgazado: conserva la foto auditable del censo
 * (identidad, camas, diagnóstico, movimientos) sin los campos derivados
 * pesados ni el historial Rayen embebido. Nadie lee estos snapshots
 * programáticamente (la restauración de versiones usa conflictSnapshots/).
 */
const buildSlimHistorySnapshot = (record, now) => {
  const beds = {};
  Object.entries(record.beds || {}).forEach(([bedId, bed]) => {
    beds[bedId] = slimHistoryBed(bed);
  });
  const snapshot = {
    ...record,
    beds,
    snapshotTimestamp: now,
    historyCompression: 'slim-v1',
  };
  delete snapshot.rayenSyncHistory;
  return snapshot;
};

const readValueAtPath = (record, path) =>
  String(path)
    .split('.')
    .reduce((current, segment) => {
      if (!current || typeof current !== 'object') return undefined;
      return current[segment];
    }, record);

// Keep track of fields that the server, rather than the incoming patch,
// changes while preserving a confirmed episode or applying a rule. A partial
// Firestore update must include those fields as well as the client paths.
const specialtyFieldSnapshot = record => {
  const fields = new Map();
  Object.entries(record.beds || {}).forEach(([bedId, bed]) => {
    for (const [target, patient] of [
      ['bed', bed],
      ['clinicalCrib', bed?.clinicalCrib],
    ]) {
      if (!isPlainObject(patient)) continue;
      const prefix = target === 'bed' ? `beds.${bedId}` : `beds.${bedId}.clinicalCrib`;
      for (const field of [
        'specialty',
        'specialtyAssignment',
        'secondarySpecialty',
        'ginecobstetriciaType',
        'deliveryRoute',
        'deliveryDate',
        'deliveryCesareanLabor',
      ]) {
        fields.set(`${prefix}.${field}`, JSON.stringify(patient[field]));
      }
    }
  });
  return fields;
};

const collectChangedPaths = syncContract =>
  Array.isArray(syncContract?.changedPaths)
    ? syncContract.changedPaths
        .filter(path => typeof path === 'string' && path.trim())
        .map(path => path.trim())
    : [];

const buildNextMeta = ({ remoteData, syncContract, now }) => {
  const mutationId = normalizeShortString(syncContract?.mutationId);
  const clientId = normalizeShortString(syncContract?.clientId);
  const tabId = normalizeShortString(syncContract?.tabId);

  return {
    ...(isPlainObject(remoteData?.meta) ? clonePlainValue(remoteData.meta) : {}),
    revision: resolveCurrentRevision(remoteData) + 1,
    lastMutationId: mutationId || null,
    lastWriterClientId: clientId || null,
    lastWriterTabId: tabId || null,
    lastChangedPaths: collectChangedPaths(syncContract),
    updatedAt: now,
  };
};

const toClientRecordValue = value => {
  if (Array.isArray(value)) {
    return value.map(toClientRecordValue);
  }

  const timestamp = toIsoTimestamp(value);
  if (
    value instanceof Date ||
    typeof value?.toDate === 'function' ||
    Number.isFinite(value?.seconds)
  ) {
    return timestamp;
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, toClientRecordValue(nestedValue)])
    );
  }

  return value;
};

const buildAuthorityRecordState = ({ record, lastUpdated, meta }) => {
  const normalizedLastUpdated = toIsoTimestamp(lastUpdated);
  if (!normalizedLastUpdated || !isPlainObject(meta) || !isPlainObject(record)) return undefined;
  const normalizedMeta = {
    ...toClientRecordValue(meta),
    updatedAt: toIsoTimestamp(meta.updatedAt) || normalizedLastUpdated,
  };
  return {
    lastUpdated: normalizedLastUpdated,
    meta: normalizedMeta,
    record: toClientRecordValue({
      ...record,
      lastUpdated: normalizedLastUpdated,
      meta: normalizedMeta,
    }),
  };
};

const hasAlreadyAppliedMutation = ({ snapshot, syncContract }) => {
  if (!snapshot.exists) {
    return false;
  }

  const remoteMutationId = normalizeShortString(snapshot.data()?.meta?.lastMutationId);
  const localMutationId = normalizeShortString(syncContract?.mutationId);
  return Boolean(remoteMutationId && localMutationId && remoteMutationId === localMutationId);
};

module.exports = {
  applyPatchToRecord,
  buildAuthorityRecordState,
  buildNextMeta,
  buildSlimHistorySnapshot,
  collectChangedPaths,
  hasAlreadyAppliedMutation,
  readValueAtPath,
  setValueAtPath,
  specialtyFieldSnapshot,
};
