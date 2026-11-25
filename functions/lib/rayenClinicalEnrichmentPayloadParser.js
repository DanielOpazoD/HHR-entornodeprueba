const crypto = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { DOCUMENTARY_FIELD_CONTRACT_VERSION } = require('./rayenDocumentaryCudyrPolicy');
const { RAYEN_CLINICAL_FIELDS } = require('./dailyRecordAuthorityContract');
const { addCalendarDays } = require('./hospitalCalendarDay');

const MAX_BATCH_TARGETS = 32;
const MAX_BATCH_BYTES = 500_000;
const MAX_PERSISTED_DOCUMENT_BYTES = 900_000;
const CANONICAL_FIELD_CONTRACT_VERSION = 2;

const ALLOWED_FIELDS = new Set(RAYEN_CLINICAL_FIELDS);
const CHECKPOINT_FIELD = 'clinicalSyncCheckpoint';
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
    throw new HttpsError(
      'invalid-argument',
      `${fieldName} must be a non-empty string of at most ${maxLength} characters.`
    );
  }
  return value.trim();
};

const assertJsonValue = (value, path = 'value') => {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    throw new HttpsError(
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
      throw new HttpsError(
        'invalid-argument',
        'Clinical enrichment contains a forbidden object key.'
      );
    }
    assertJsonValue(nested, `${path}.${key}`);
  });
};

const assertPersistedDocumentSize = value => {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_PERSISTED_DOCUMENT_BYTES) {
    throw new HttpsError(
      'resource-exhausted',
      'Clinical enrichment would exceed the safe Firestore document size.'
    );
  }
};

const parseTarget = (target, index) => {
  if (!isPlainObject(target) || !isPlainObject(target.fields)) {
    throw new HttpsError(
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
    throw new HttpsError(
      'invalid-argument',
      `Clinical enrichment target ${index} has an invalid field count.`
    );
  }
  fieldEntries.forEach(([field, value]) => {
    if (!ALLOWED_FIELDS.has(field)) {
      throw new HttpsError(
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
    throw new HttpsError(
      'invalid-argument',
      `Clinical checkpoint target ${index} must include a checkpoint.`
    );
  }
  return parseTarget(
    {
      ...target,
      fields: { [CHECKPOINT_FIELD]: target.checkpoint },
    },
    index
  );
};

const assertIsoCalendarDate = (value, field) => {
  const date = assertString(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new HttpsError('invalid-argument', `${field} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new HttpsError('invalid-argument', `${field} must be a valid calendar date.`);
  }
  return date;
};

const parseClinicalEnrichmentPayload = data => {
  const date = assertIsoCalendarDate(data?.date, 'date');
  // Runtime v1 did not send authorityDate. During the bounded v1/v2 rollout it may only target
  // its own census day; historical writes always require the explicit v2 authority binding.
  const authorityDateProvided = data?.authorityDate !== undefined;
  const authorityDate = authorityDateProvided
    ? assertIsoCalendarDate(data.authorityDate, 'authorityDate')
    : date;
  const allowedHistoricalDate = addCalendarDays(authorityDate, -1);
  if (date !== authorityDate && date !== allowedHistoricalDate) {
    throw new HttpsError(
      'invalid-argument',
      'Clinical enrichment may target only the run day or its immediately preceding census day.'
    );
  }
  const runId = assertString(data?.runId, 'runId', 120);
  const mutationId = assertString(data?.mutationId, 'mutationId', 160);
  if (data?.mode !== 'enforced') {
    throw new HttpsError('invalid-argument', 'Clinical enrichment mode must be enforced.');
  }
  const mode = data.mode;
  if (
    data?.fieldContractVersion !== undefined &&
    data.fieldContractVersion !== 1 &&
    data.fieldContractVersion !== CANONICAL_FIELD_CONTRACT_VERSION &&
    data.fieldContractVersion !== DOCUMENTARY_FIELD_CONTRACT_VERSION
  ) {
    throw new HttpsError(
      'invalid-argument',
      'Clinical enrichment fieldContractVersion is not supported.'
    );
  }
  const fieldContractVersion =
    data?.fieldContractVersion >= CANONICAL_FIELD_CONTRACT_VERSION ? data.fieldContractVersion : 1;
  if (!authorityDateProvided && fieldContractVersion !== CANONICAL_FIELD_CONTRACT_VERSION) {
    throw new HttpsError(
      'invalid-argument',
      'Legacy authority inference requires the canonical field contract.'
    );
  }
  const expectedLastUpdated = assertString(data?.expectedLastUpdated, 'expectedLastUpdated', 80);
  if (!Number.isFinite(Date.parse(expectedLastUpdated))) {
    throw new HttpsError(
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
    throw new HttpsError(
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
        throw new HttpsError(
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
      throw new HttpsError(
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
      throw new HttpsError(
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
      throw new HttpsError(
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
    throw new HttpsError(
      'invalid-argument',
      `Clinical enrichment exceeds ${MAX_BATCH_TARGETS} unique targets.`
    );
  }
  // The sections exactly as received: the client measures the same object before sending
  // (prepareClinicalEnrichmentBatchPayload). The parsed targets add `clinicalCrib: false` and wrap
  // each checkpoint, so measuring them rejected a batch the client had already sized as valid.
  const receivedSections = {
    patches: Array.isArray(data.patches) ? data.patches : [],
    ...(rawCheckpoints.length > 0 ? { checkpoints: data.checkpoints } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(receivedSections), 'utf8') > MAX_BATCH_BYTES) {
    throw new HttpsError(
      'invalid-argument',
      'Clinical enrichment batch exceeds the allowed payload size.'
    );
  }

  const baseRevision =
    data?.baseRevision === null || data?.baseRevision === undefined || data?.baseRevision === ''
      ? undefined
      : Number(data.baseRevision);
  return {
    date,
    authorityDate,
    legacyAuthorityInference: !authorityDateProvided,
    runId,
    mutationId,
    mode,
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
    baseRevision:
      typeof baseRevision === 'number' && Number.isInteger(baseRevision) && baseRevision >= 0
        ? baseRevision
        : undefined,
  };
};

module.exports = {
  ALLOWED_FIELDS,
  CANONICAL_FIELD_CONTRACT_VERSION,
  CHECKPOINT_FIELD,
  MAX_BATCH_TARGETS,
  applyEstablishedPatchValue,
  assertPersistedDocumentSize,
  canonicalize,
  clonePlainValue,
  compareCodeUnits,
  digestValue,
  establishedPatchValueMatches,
  isPlainObject,
  parseClinicalEnrichmentPayload,
  targetKey,
};
