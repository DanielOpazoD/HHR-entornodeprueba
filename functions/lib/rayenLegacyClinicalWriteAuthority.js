const functions = require('firebase-functions/v1');

const CLINICAL_BATCH_MODES = new Set(['off', 'shadow', 'enforced']);
const IMPORT_MODES = new Set(['preview', 'auto']);
const RECORD_SCOPES = new Set(['run', 'historical']);
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const previousIsoDay = isoDay => {
  const date = new Date(`${isoDay}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
};

const parseRayenClinicalWriteGuard = value => {
  if (!isPlainObject(value)) return undefined;
  const guard = {
    runId: typeof value.runId === 'string' ? value.runId.trim() : '',
    importMode: value.importMode,
    clinicalBatchMode: value.clinicalBatchMode,
    revision: value.revision,
    sourceDate: value.sourceDate,
    recordScope: value.recordScope,
  };
  if (
    !guard.runId ||
    !/^[A-Za-z0-9_-]{1,120}$/.test(guard.runId) ||
    !IMPORT_MODES.has(guard.importMode) ||
    !CLINICAL_BATCH_MODES.has(guard.clinicalBatchMode) ||
    !Number.isInteger(guard.revision) ||
    guard.revision < 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(guard.sourceDate || '')) ||
    !RECORD_SCOPES.has(guard.recordScope)
  ) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid Rayen clinical write guard.');
  }
  return guard;
};

const isHistoricalCudyrPatchPath = path => {
  const parts = String(path)
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.some(part => FORBIDDEN_PATH_SEGMENTS.has(part))) return false;
  if (parts[0] !== 'beds' || !parts[1]) return false;
  if (parts.length === 4) {
    return parts[2] === 'evaluationScores' && parts[3] === 'cudyr';
  }
  return (
    parts.length === 5 &&
    parts[2] === 'clinicalCrib' &&
    parts[3] === 'evaluationScores' &&
    parts[4] === 'cudyr'
  );
};

const isCanonicalCudyrValue = value =>
  isPlainObject(value) &&
  typeof value.category === 'string' &&
  Boolean(value.category.trim()) &&
  typeof value.recordedDate === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(value.recordedDate) &&
  typeof value.source === 'string' &&
  Boolean(value.source.trim());

const isGuardedClinicalPatchPath = (path, clinicalFields) => {
  const parts = String(path)
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.some(part => FORBIDDEN_PATH_SEGMENTS.has(part))) return false;
  if (parts[0] !== 'beds' || !parts[1]) return false;
  if (parts.length === 3) return clinicalFields.has(parts[2]);
  return parts.length === 4 && parts[2] === 'clinicalCrib' && clinicalFields.has(parts[3]);
};

const assertGuardedClinicalPatch = ({ patch, clinicalFields, recordScope = 'run' }) => {
  if (recordScope === 'historical') {
    if (
      !Object.entries(patch).every(
        ([path, value]) => isHistoricalCudyrPatchPath(path) && isCanonicalCudyrValue(value)
      )
    ) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'A historical Rayen write may contain only canonical CUDYR score values.'
      );
    }
    return;
  }
  if (!Object.keys(patch).every(path => isGuardedClinicalPatchPath(path, clinicalFields))) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'A guarded Rayen write may contain only server-owned clinical fields.'
    );
  }
};

const normalizedClinicalMode = value => (value === undefined ? 'off' : String(value));

const policyMatchesGuard = (policySnapshot, guard) => {
  if (guard.clinicalBatchMode === 'enforced') return false;
  if (!policySnapshot?.exists) {
    return (
      guard.revision === 0 && guard.importMode === 'preview' && guard.clinicalBatchMode === 'off'
    );
  }
  const policy = policySnapshot.data?.() || {};
  return (
    policy.schemaVersion === 2 &&
    policy.mode === guard.importMode &&
    policy.revision === guard.revision &&
    normalizedClinicalMode(policy.clinicalBatchMode) === guard.clinicalBatchMode
  );
};

const recordContainsGuardedRun = (record, guard) =>
  Array.isArray(record?.rayenSyncHistory) &&
  record.rayenSyncHistory.some(event => {
    if (!isPlainObject(event) || !isPlainObject(event.policy)) return false;
    const eventSourceDate =
      typeof event.sourceDate === 'string' && event.sourceDate ? event.sourceDate : record.date;
    return (
      event.id === guard.runId &&
      event.status === 'applied' &&
      eventSourceDate === guard.sourceDate &&
      event.policy.mode === guard.importMode &&
      event.policy.revision === guard.revision &&
      normalizedClinicalMode(event.policy.clinicalBatchMode) === guard.clinicalBatchMode
    );
  });

const assertRayenLegacyClinicalWriteAuthority = ({
  policySnapshot,
  runRecord,
  targetDate,
  guard,
  role,
}) => {
  if (guard.recordScope === 'historical' && role !== 'admin') {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Historical Rayen clinical writes require an administrator.'
    );
  }
  const expectedTargetDate =
    guard.recordScope === 'historical' ? previousIsoDay(guard.sourceDate) : guard.sourceDate;
  if (
    !policyMatchesGuard(policySnapshot, guard) ||
    targetDate !== expectedTargetDate ||
    !recordContainsGuardedRun(runRecord, guard)
  ) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Rayen clinical policy or synchronization run changed before persistence.'
    );
  }
};

module.exports = {
  assertGuardedClinicalPatch,
  assertRayenLegacyClinicalWriteAuthority,
  isHistoricalCudyrPatchPath,
  isGuardedClinicalPatchPath,
  parseRayenClinicalWriteGuard,
};
