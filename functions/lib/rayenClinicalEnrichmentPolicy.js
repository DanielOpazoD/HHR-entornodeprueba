const crypto = require('node:crypto');
const functions = require('firebase-functions/v1');

const MAX_BATCH_TARGETS = 32;
const MAX_BATCH_BYTES = 500_000;
const MAX_PERSISTED_DOCUMENT_BYTES = 900_000;
const MAX_RECEIPTS = 16;
const CANONICAL_FIELD_CONTRACT_VERSION = 2;

const ALLOWED_FIELDS = new Set([
  'devices',
  'deviceDetails',
  'deviceInstanceHistory',
  'evaluationScores',
  'vitalSigns',
  'vitalSignsHistory',
  'clinicalSyncCheckpoint',
]);
const CHECKPOINT_FIELD = 'clinicalSyncCheckpoint';

const MISMATCH_SECTION_BY_FIELD = Object.freeze({
  devices: 'devices',
  deviceDetails: 'devices',
  deviceInstanceHistory: 'devices',
  evaluationScores: 'scores',
  vitalSigns: 'vitals',
  vitalSignsHistory: 'vitals',
  clinicalSyncCheckpoint: 'checkpoints',
});

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

const isPatchMap = value =>
  isPlainObject(value) && !(value instanceof Date) && typeof value?.toDate !== 'function';

const applyLegacyPatchValue = (current, requested) => {
  if (!isPatchMap(requested)) return clonePlainValue(requested);
  const entries = Object.entries(requested);
  if (entries.length === 0) return {};
  const next = isPatchMap(current) ? clonePlainValue(current) : {};
  entries.forEach(([key, value]) => {
    next[key] = applyLegacyPatchValue(next[key], value);
  });
  return next;
};

const legacyPatchValueMatches = (current, requested) => {
  if (!isPatchMap(requested)) return canonicalize(current) === canonicalize(requested);
  const entries = Object.entries(requested);
  if (entries.length === 0) return isPatchMap(current) && Object.keys(current).length === 0;
  return (
    isPatchMap(current) &&
    entries.every(([key, value]) => legacyPatchValueMatches(current[key], value))
  );
};

// Contract v2 declares that every allowlisted field is a complete canonical value assembled by
// the frontend mergers. Unversioned clients keep the established recursive merge semantics during
// rolling deployments, while v2 can remove stale optional leaves and converge subsequent runs.
const applyEstablishedPatchValue = (current, requested, fieldContractVersion) =>
  fieldContractVersion >= CANONICAL_FIELD_CONTRACT_VERSION
    ? clonePlainValue(requested)
    : applyLegacyPatchValue(current, requested);

const establishedPatchValueMatches = (current, requested, fieldContractVersion) =>
  fieldContractVersion >= CANONICAL_FIELD_CONTRACT_VERSION
    ? canonicalize(current) === canonicalize(requested)
    : legacyPatchValueMatches(current, requested);

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

const targetKey = target => `${target.bedId}|${target.clinicalCrib ? 'crib' : 'patient'}`;

const parseCheckpointTarget = (target, index) => {
  if (!isPlainObject(target) || !Object.prototype.hasOwnProperty.call(target, 'checkpoint')) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Clinical checkpoint target ${index} must include a checkpoint.`
    );
  }
  const parsed = parseTarget(
    {
      ...target,
      fields: { [CHECKPOINT_FIELD]: target.checkpoint },
    },
    index
  );
  return parsed;
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
  if (
    data?.fieldContractVersion !== undefined &&
    data.fieldContractVersion !== 1 &&
    data.fieldContractVersion !== CANONICAL_FIELD_CONTRACT_VERSION
  ) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Clinical enrichment fieldContractVersion is not supported.'
    );
  }
  const fieldContractVersion =
    data?.fieldContractVersion === CANONICAL_FIELD_CONTRACT_VERSION
      ? CANONICAL_FIELD_CONTRACT_VERSION
      : 1;
  const expectedLastUpdated = assertString(data?.expectedLastUpdated, 'expectedLastUpdated', 80);
  if (!Number.isFinite(Date.parse(expectedLastUpdated))) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'expectedLastUpdated must be a valid date-time value.'
    );
  }
  const rawPatches = Array.isArray(data?.patches) ? data.patches.map(parseTarget) : [];
  const rawCheckpoints = Array.isArray(data?.checkpoints)
    ? data.checkpoints.map(parseCheckpointTarget)
    : [];
  if (
    rawPatches.length + rawCheckpoints.length === 0 ||
    rawPatches.length > MAX_BATCH_TARGETS ||
    rawCheckpoints.length > MAX_BATCH_TARGETS
  ) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Clinical enrichment requires between 1 and ${MAX_BATCH_TARGETS} targets per section.`
    );
  }

  const clinicalPatches = [];
  const checkpointsByTarget = new Map();
  rawPatches.forEach(target => {
    const clinicalFields = Object.fromEntries(
      Object.entries(target.fields).filter(([field]) => field !== CHECKPOINT_FIELD)
    );
    if (Object.keys(clinicalFields).length > 0) {
      clinicalPatches.push({ ...target, fields: clinicalFields });
    }
    if (Object.prototype.hasOwnProperty.call(target.fields, CHECKPOINT_FIELD)) {
      const key = targetKey(target);
      if (checkpointsByTarget.has(key)) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'Clinical enrichment contains a duplicate checkpoint target.'
        );
      }
      checkpointsByTarget.set(key, {
        ...target,
        fields: { [CHECKPOINT_FIELD]: target.fields[CHECKPOINT_FIELD] },
      });
    }
  });
  rawCheckpoints.forEach(target => {
    const key = targetKey(target);
    if (checkpointsByTarget.has(key)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Clinical enrichment contains a duplicate checkpoint target.'
      );
    }
    checkpointsByTarget.set(key, target);
  });
  const clinicalKeys = new Set();
  clinicalPatches.forEach(target => {
    const key = targetKey(target);
    if (clinicalKeys.has(key)) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Clinical enrichment contains a duplicate clinical target.'
      );
    }
    clinicalKeys.add(key);
  });
  const targetsByKey = new Map();
  [...clinicalPatches, ...checkpointsByTarget.values()].forEach(target => {
    const key = targetKey(target);
    const previous = targetsByKey.get(key);
    if (previous && previous.clinicalEpisodeId !== target.clinicalEpisodeId) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Clinical enrichment target sections must reference the same clinical episode.'
      );
    }
    targetsByKey.set(key, {
      ...target,
      fields: { ...(previous?.fields || {}), ...target.fields },
    });
  });
  if (targetsByKey.size > MAX_BATCH_TARGETS) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Clinical enrichment exceeds ${MAX_BATCH_TARGETS} unique targets.`
    );
  }
  const receivedSections = {
    patches: rawPatches,
    ...(rawCheckpoints.length > 0 ? { checkpoints: rawCheckpoints } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(receivedSections), 'utf8') > MAX_BATCH_BYTES) {
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
    fieldContractVersion,
    patches: clinicalPatches.sort(
      (left, right) =>
        compareCodeUnits(left.bedId, right.bedId) ||
        Number(left.clinicalCrib) - Number(right.clinicalCrib)
    ),
    checkpoints: [...checkpointsByTarget.values()].sort(
      (left, right) =>
        compareCodeUnits(left.bedId, right.bedId) ||
        Number(left.clinicalCrib) - Number(right.clinicalCrib)
    ),
    targets: [...targetsByKey.values()].sort(
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

const applyClinicalEnrichment = (record, patches, fieldContractVersion = 1) => {
  const next = clonePlainValue(record);
  patches.forEach(target => {
    assertTargetMatchesEpisode(next, target);
    const bed = next.beds[target.bedId];
    const patient = target.clinicalCrib ? bed.clinicalCrib : bed;
    Object.entries(target.fields).forEach(([field, value]) => {
      patient[field] = applyEstablishedPatchValue(patient[field], value, fieldContractVersion);
    });
  });
  return next;
};

const clinicalEnrichmentMatches = (record, targets, fieldContractVersion = 1) =>
  targets.every(target => {
    const patient = assertTargetMatchesEpisode(record, target);
    return Object.entries(target.fields).every(([field, value]) =>
      establishedPatchValueMatches(patient[field], value, fieldContractVersion)
    );
  });

const summarizeClinicalEnrichmentMismatches = (record, targets, fieldContractVersion = 1) => {
  const summary = {
    mismatchTargetCount: 0,
    mismatchFieldCount: 0,
    mismatchDeviceFieldCount: 0,
    mismatchScoreFieldCount: 0,
    mismatchVitalFieldCount: 0,
    mismatchCheckpointFieldCount: 0,
  };

  targets.forEach(target => {
    const patient = assertTargetMatchesEpisode(record, target);
    let targetMismatch = false;
    Object.entries(target.fields).forEach(([field, value]) => {
      if (establishedPatchValueMatches(patient[field], value, fieldContractVersion)) return;
      targetMismatch = true;
      summary.mismatchFieldCount += 1;
      const section = MISMATCH_SECTION_BY_FIELD[field];
      if (section === 'devices') summary.mismatchDeviceFieldCount += 1;
      if (section === 'scores') summary.mismatchScoreFieldCount += 1;
      if (section === 'vitals') summary.mismatchVitalFieldCount += 1;
      if (section === 'checkpoints') summary.mismatchCheckpointFieldCount += 1;
    });
    if (targetMismatch) summary.mismatchTargetCount += 1;
  });

  return summary;
};

const resolveReceipts = record =>
  Array.isArray(record?.meta?.clinicalEnrichmentReceipts)
    ? record.meta.clinicalEnrichmentReceipts.filter(isPlainObject)
    : [];

const classifyIdempotency = (record, payload, batchDigest, compatibleDigests = []) => {
  const acceptedDigests = new Set([batchDigest, ...compatibleDigests]);
  const receipts = resolveReceipts(record);
  const sameMutation = receipts.find(receipt => receipt.mutationId === payload.mutationId);
  if (sameMutation) {
    if (sameMutation.runId === payload.runId && acceptedDigests.has(sameMutation.digest)) {
      return 'idempotent';
    }
    throw new functions.https.HttpsError(
      'failed-precondition',
      'mutationId was already used with a different clinical enrichment payload.'
    );
  }
  const sameRun = receipts.find(receipt => receipt.runId === payload.runId);
  if (!sameRun) return 'new';
  if (acceptedDigests.has(sameRun.digest)) return 'idempotent';
  throw new functions.https.HttpsError(
    'failed-precondition',
    'runId was already used with a different clinical enrichment payload.'
  );
};

const buildLegacyClinicalEnrichmentDigest = payload => {
  const checkpointsByTarget = new Map(
    payload.checkpoints.map(target => [targetKey(target), target])
  );
  const clinicalKeys = new Set(payload.patches.map(targetKey));
  const patches = payload.patches.map(target => {
    const checkpoint = checkpointsByTarget.get(targetKey(target));
    return checkpoint
      ? {
          ...target,
          fields: {
            ...target.fields,
            [CHECKPOINT_FIELD]: checkpoint.fields[CHECKPOINT_FIELD],
          },
        }
      : target;
  });
  payload.checkpoints.forEach(target => {
    if (!clinicalKeys.has(targetKey(target))) patches.push(target);
  });
  patches.sort(
    (left, right) =>
      compareCodeUnits(left.bedId, right.bedId) ||
      Number(left.clinicalCrib) - Number(right.clinicalCrib)
  );
  return digestValue({ date: payload.date, patches });
};

const buildClinicalEnrichmentMeta = ({ record, payload, batchDigest, now }) => {
  const receipts = resolveReceipts(record)
    .filter(receipt => receipt.runId !== payload.runId && receipt.mutationId !== payload.mutationId)
    .slice(-(MAX_RECEIPTS - 1));
  return {
    ...(isPlainObject(record?.meta) ? clonePlainValue(record.meta) : {}),
    revision: resolveRecordRevision(record) + 1,
    lastMutationId: payload.mutationId,
    lastChangedPaths: payload.targets.flatMap(target =>
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
  clinicalEnrichmentMatches,
  assertPersistedDocumentSize,
  assertRecordRevision,
  buildClinicalEnrichmentMeta,
  buildHistorySnapshotId,
  buildLegacyClinicalEnrichmentDigest,
  classifyIdempotency,
  digestValue,
  parseClinicalEnrichmentPayload,
  resolveRecordRevision,
  summarizeClinicalEnrichmentMismatches,
};
