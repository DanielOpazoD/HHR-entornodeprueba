const crypto = require('node:crypto');
const functions = require('firebase-functions/v1');

const MAX_BATCH_TARGETS = 32;
const MAX_BATCH_BYTES = 500_000;
const MAX_PERSISTED_DOCUMENT_BYTES = 900_000;
const MAX_RECEIPTS = 16;

const ALLOWED_FIELDS = new Set([
  'devices',
  'deviceDetails',
  'deviceInstanceHistory',
  'evaluationScores',
  'vitalSigns',
  'vitalSignsHistory',
  'clinicalSyncCheckpoint',
]);

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const compareCodeUnits = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

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

const assertString = (value, fieldName, maxLength) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `${fieldName} must be a non-empty string of at most ${maxLength} characters.`
    );
  }
  return value.trim();
};

const assertJsonValue = (value, path = 'value') => {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Clinical enrichment contains an unsupported value at ${path}.`
    );
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  Object.entries(value).forEach(([key, nested]) => {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Clinical enrichment contains a forbidden object key.'
      );
    }
    assertJsonValue(nested, `${path}.${key}`);
  });
};

const canonicalize = value => {
  if (value === undefined) return 'undefined';
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.entries(value)
    .filter(([, nested]) => nested !== undefined)
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalize(nested)}`)
    .join(',')}}`;
};

const digestValue = value => crypto.createHash('sha256').update(canonicalize(value)).digest('hex');

const assertPersistedDocumentSize = value => {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_PERSISTED_DOCUMENT_BYTES) {
    throw new functions.https.HttpsError(
      'resource-exhausted',
      'Clinical enrichment would exceed the safe Firestore document size.'
    );
  }
};

const parseTarget = (target, index) => {
  if (!isPlainObject(target) || !isPlainObject(target.fields)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Clinical enrichment target ${index} must include a fields object.`
    );
  }

  const bedId = assertString(target.bedId, `patches[${index}].bedId`, 40);
  const clinicalEpisodeId = assertString(
    target.clinicalEpisodeId,
    `patches[${index}].clinicalEpisodeId`,
    120
  );
  const fieldEntries = Object.entries(target.fields);
  if (fieldEntries.length === 0 || fieldEntries.length > ALLOWED_FIELDS.size) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Clinical enrichment target ${index} has an invalid field count.`
    );
  }
  fieldEntries.forEach(([field, value]) => {
    if (!ALLOWED_FIELDS.has(field)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `Clinical enrichment field is not allowed: ${field.slice(0, 80)}`
      );
    }
    assertJsonValue(value, `patches[${index}].fields.${field}`);
  });

  return {
    bedId,
    clinicalEpisodeId,
    clinicalCrib: target.clinicalCrib === true,
    fields: clonePlainValue(target.fields),
  };
};

const parseClinicalEnrichmentPayload = data => {
  const date = assertString(data?.date, 'date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new functions.https.HttpsError('invalid-argument', 'date must use YYYY-MM-DD.');
  }
  const runId = assertString(data?.runId, 'runId', 120);
  const mutationId = assertString(data?.mutationId, 'mutationId', 160);
  if (data?.mode !== 'shadow' && data?.mode !== 'enforced') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Clinical enrichment mode must be shadow or enforced.'
    );
  }
  const mode = data.mode;
  const dryRun = mode === 'shadow';
  const expectedLastUpdated = assertString(data?.expectedLastUpdated, 'expectedLastUpdated', 80);
  if (!Number.isFinite(Date.parse(expectedLastUpdated))) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'expectedLastUpdated must be a valid date-time value.'
    );
  }
  const patches = Array.isArray(data?.patches) ? data.patches.map(parseTarget) : [];
  if (patches.length === 0 || patches.length > MAX_BATCH_TARGETS) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Clinical enrichment requires between 1 and ${MAX_BATCH_TARGETS} targets.`
    );
  }

  const uniqueTargets = new Set();
  patches.forEach(target => {
    const key = `${target.bedId}|${target.clinicalCrib ? 'crib' : 'patient'}`;
    if (uniqueTargets.has(key)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Clinical enrichment contains a duplicate target.'
      );
    }
    uniqueTargets.add(key);
  });
  if (Buffer.byteLength(JSON.stringify(patches), 'utf8') > MAX_BATCH_BYTES) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Clinical enrichment batch exceeds the allowed payload size.'
    );
  }

  const baseRevision = Number(data?.baseRevision);
  return {
    date,
    runId,
    mutationId,
    mode,
    dryRun,
    patches: patches.sort(
      (left, right) =>
        compareCodeUnits(left.bedId, right.bedId) ||
        Number(left.clinicalCrib) - Number(right.clinicalCrib)
    ),
    expectedLastUpdated,
    baseRevision: Number.isFinite(baseRevision) && baseRevision >= 0 ? baseRevision : undefined,
  };
};

const resolveRecordRevision = record => {
  const revision = Number(record?.meta?.revision);
  return Number.isFinite(revision) && revision >= 0 ? revision : 0;
};

const toMillis = value => {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
};

const assertRecordRevision = (record, payload) => {
  const currentRevision = resolveRecordRevision(record);
  if (payload.mode === 'shadow') return currentRevision;
  if (payload.baseRevision !== undefined && currentRevision !== payload.baseRevision) {
    throw new functions.https.HttpsError(
      'aborted',
      `revision_mismatch: expected ${payload.baseRevision}, received ${currentRevision}.`
    );
  }
  if (toMillis(record?.lastUpdated) !== toMillis(payload.expectedLastUpdated)) {
    throw new functions.https.HttpsError(
      'aborted',
      'version_mismatch: the daily record changed before clinical enrichment.'
    );
  }
  return currentRevision;
};

const assertTargetMatchesEpisode = (record, target) => {
  const bed = record?.beds?.[target.bedId];
  const patient = target.clinicalCrib ? bed?.clinicalCrib : bed;
  if (!isPlainObject(patient) || patient.isBlocked === true) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Clinical enrichment target is no longer active.'
    );
  }
  if (String(patient.clinicalEpisodeId || '').trim() !== target.clinicalEpisodeId) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Clinical enrichment target episode no longer matches the census.'
    );
  }
  return patient;
};

const applyClinicalEnrichment = (record, patches) => {
  const next = clonePlainValue(record);
  patches.forEach(target => {
    assertTargetMatchesEpisode(next, target);
    const bed = next.beds[target.bedId];
    const patient = target.clinicalCrib ? bed.clinicalCrib : bed;
    Object.entries(target.fields).forEach(([field, value]) => {
      patient[field] = clonePlainValue(value);
    });
  });
  return next;
};

const resolveReceipts = record =>
  Array.isArray(record?.meta?.clinicalEnrichmentReceipts)
    ? record.meta.clinicalEnrichmentReceipts.filter(isPlainObject)
    : [];

const classifyIdempotency = (record, payload, batchDigest) => {
  const receipts = resolveReceipts(record);
  const sameMutation = receipts.find(receipt => receipt.mutationId === payload.mutationId);
  if (sameMutation) {
    if (sameMutation.runId === payload.runId && sameMutation.digest === batchDigest) {
      return 'idempotent';
    }
    throw new functions.https.HttpsError(
      'failed-precondition',
      'mutationId was already used with a different clinical enrichment payload.'
    );
  }
  const sameRun = receipts.find(receipt => receipt.runId === payload.runId);
  if (!sameRun) return 'new';
  if (sameRun.digest === batchDigest) return 'idempotent';
  throw new functions.https.HttpsError(
    'failed-precondition',
    'runId was already used with a different clinical enrichment payload.'
  );
};

const buildClinicalEnrichmentMeta = ({ record, payload, batchDigest, now }) => {
  const receipts = resolveReceipts(record)
    .filter(receipt => receipt.runId !== payload.runId && receipt.mutationId !== payload.mutationId)
    .slice(-(MAX_RECEIPTS - 1));
  return {
    ...(isPlainObject(record?.meta) ? clonePlainValue(record.meta) : {}),
    revision: resolveRecordRevision(record) + 1,
    lastMutationId: payload.mutationId,
    lastChangedPaths: payload.patches.flatMap(target =>
      Object.keys(target.fields).map(
        field => `beds.${target.bedId}${target.clinicalCrib ? '.clinicalCrib' : ''}.${field}`
      )
    ),
    updatedAt: now,
    clinicalEnrichmentReceipts: [
      ...receipts,
      {
        runId: payload.runId,
        mutationId: payload.mutationId,
        digest: batchDigest,
        appliedAt: now,
      },
    ],
  };
};

const buildHistorySnapshotId = runId => `rayen-clinical-${digestValue(runId).slice(0, 24)}`;

module.exports = {
  ALLOWED_FIELDS,
  MAX_BATCH_TARGETS,
  applyClinicalEnrichment,
  assertPersistedDocumentSize,
  assertRecordRevision,
  buildClinicalEnrichmentMeta,
  buildHistorySnapshotId,
  classifyIdempotency,
  digestValue,
  parseClinicalEnrichmentPayload,
  resolveRecordRevision,
};
