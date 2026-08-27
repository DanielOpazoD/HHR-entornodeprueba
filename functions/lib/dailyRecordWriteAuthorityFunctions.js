const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { requireAuthenticatedEmail } = require('./auth/authPolicies');
const { sanitizeLogValue } = require('./logging/redaction');
const {
  collectClinicalEpisodeCoverage,
  evaluateDailyRecordClinicalAuthority,
} = require('./dailyRecordClinicalAuthorityPolicy');
const { findPatientErasures } = require('./dailyRecordErasureGuard');
const {
  RAYEN_CLINICAL_FIELDS,
  isRayenClinicalWriteFenceActive,
  preserveRayenClinicalFields,
} = require('./dailyRecordClinicalFieldPreservation');
const {
  assertGuardedClinicalPatch,
  assertRayenLegacyClinicalWriteAuthority,
  isGuardedClinicalPatchPath,
  isHistoricalCudyrPatchPath,
  parseRayenClinicalWriteGuard,
} = require('./rayenLegacyClinicalWriteAuthority');

const ALLOWED_DAILY_RECORD_WRITE_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
  'editor',
]);

const ALLOWED_DAILY_RECORD_PATCH_FIELDS = new Set([
  'pathology',
  'diagnosisComments',
  'snomedCode',
  'cie10Code',
  'cie10Description',
  'treatingPhysicianId',
  'treatingPhysicianName',
  'specialty',
  'secondarySpecialty',
  'status',
  'ginecobstetriciaType',
  'deliveryRoute',
  'deliveryDate',
  'deliveryCesareanLabor',
  'isUPC',
  'upcChecklist',
  'surgicalComplication',
]);

const ALLOWED_DAILY_RECORD_BED_TYPE_OVERRIDE_VALUES = new Set(['UTI', 'UCI', 'MEDIA', null]);
const STRUCTURAL_DAILY_RECORD_PATCH_ROLES = new Set(['admin', 'nurse_hospital']);

const FORBIDDEN_PATCH_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const RAYEN_CLINICAL_PATCH_FIELDS = new Set(RAYEN_CLINICAL_FIELDS);

const assertStringField = (value, fieldName) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Missing required field: ${fieldName}`
    );
  }

  return value.trim();
};

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeMode = value => (value === 'shadow' ? 'shadow' : 'enforced');

const normalizeOrigin = (value, fallback = 'direct_save') =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : fallback;

const normalizeShortString = (value, maxLength = 120) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : undefined;

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

const parseAuthorizedPatchPath = (
  path,
  role,
  guardedClinicalWrite = false,
  guardedRecordScope = 'run'
) => {
  const parts = String(path)
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);

  if (
    guardedClinicalWrite &&
    (isGuardedClinicalPatchPath(path, RAYEN_CLINICAL_PATCH_FIELDS) ||
      (guardedRecordScope === 'historical' && isHistoricalCudyrPatchPath(path)))
  ) {
    return {
      kind: 'rayenClinicalField',
      bedId: parts[1],
      field: parts[parts.length - 1],
    };
  }

  if (
    parts.length === 3 &&
    parts[0] === 'beds' &&
    !parts.some(part => FORBIDDEN_PATCH_PATH_SEGMENTS.has(part)) &&
    ALLOWED_DAILY_RECORD_PATCH_FIELDS.has(parts[2])
  ) {
    return {
      kind: 'patientField',
      bedId: parts[1],
      field: parts[2],
    };
  }

  if (
    parts.length === 2 &&
    parts[0] === 'bedTypeOverrides' &&
    !parts.some(part => FORBIDDEN_PATCH_PATH_SEGMENTS.has(part))
  ) {
    return {
      kind: 'bedTypeOverride',
      bedId: parts[1],
      field: 'bedTypeOverride',
    };
  }

  // Once policy schema v2 is active, Firestore deliberately fences the whole beds tree.
  // Admin/nurse structural edits are therefore authorized here and later merged while preserving
  // every server-owned clinical field. Other roles retain the narrow allowlist above.
  if (
    parts.length >= 3 &&
    parts[0] === 'beds' &&
    !parts.some(part => FORBIDDEN_PATCH_PATH_SEGMENTS.has(part)) &&
    STRUCTURAL_DAILY_RECORD_PATCH_ROLES.has(role)
  ) {
    return {
      kind: 'structuralField',
      bedId: parts[1],
      field: parts[parts.length - 1],
    };
  }

  throw new functions.https.HttpsError(
    'invalid-argument',
    `Daily record patch path is not allowed: ${String(path).slice(0, 120)}`
  );
};

const assertAuthorizedPatchValue = ({ path, value, parsedPath, patchPaths }) => {
  if (parsedPath.kind !== 'bedTypeOverride') {
    return;
  }

  if (!ALLOWED_DAILY_RECORD_BED_TYPE_OVERRIDE_VALUES.has(value)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Daily record bed type override value is not allowed: ${String(path).slice(0, 120)}`
    );
  }

  if (
    !patchPaths.has(`beds.${parsedPath.bedId}.upcChecklist`) &&
    !patchPaths.has(`beds.${parsedPath.bedId}.isUPC`)
  ) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Daily record bed type override must accompany a UPC patch: ${String(path).slice(0, 120)}`
    );
  }
};

const inspectAuthorizedPatch = ({
  remoteData,
  patch,
  role,
  guardedClinicalWrite = false,
  guardedRecordScope = 'run',
}) => {
  const patchPaths = new Set(Object.keys(patch));
  let requiresStructuralAuthority = false;
  Object.entries(patch).forEach(([path, value]) => {
    const parsedPath = parseAuthorizedPatchPath(
      path,
      role,
      guardedClinicalWrite,
      guardedRecordScope
    );
    if (parsedPath.kind === 'structuralField') {
      const patient = remoteData?.beds?.[parsedPath.bedId];
      if (!isPlainObject(patient)) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Daily record patch target bed is not present: ${parsedPath.bedId}`
        );
      }
      if (patient.isBlocked === true) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Daily record patch target bed is blocked: ${parsedPath.bedId}`
        );
      }
      requiresStructuralAuthority = true;
      return;
    }
    assertAuthorizedPatchValue({ path, value, parsedPath, patchPaths });
    const { bedId } = parsedPath;
    const patient = remoteData?.beds?.[bedId];
    if (!isPlainObject(patient)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Daily record patch target bed is not present: ${bedId}`
      );
    }
    if (patient.isBlocked === true) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Daily record patch target bed is blocked: ${bedId}`
      );
    }
    if (
      !patient.clinicalEpisodeId &&
      !patient.rut &&
      !patient.patientName &&
      !patient.admissionDate
    ) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Daily record patch target bed has no active clinical episode identity: ${bedId}`
      );
    }
  });
  return { requiresStructuralAuthority };
};

const isRayenClinicalOwnedPatchPath = path => {
  const parts = String(path)
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);
  if (parts[0] !== 'beds' || !parts[1]) return false;
  if (RAYEN_CLINICAL_PATCH_FIELDS.has(parts[2])) return true;
  return parts[2] === 'clinicalCrib' && RAYEN_CLINICAL_PATCH_FIELDS.has(parts[3]);
};

const assertNoRayenClinicalOwnedPatch = patch => {
  if (!Object.keys(patch).some(isRayenClinicalOwnedPatchPath)) return;
  throw new functions.https.HttpsError(
    'failed-precondition',
    'Rayen clinical fields must be written through the authoritative clinical batch.'
  );
};

const toCalendarDayOrdinal = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return undefined;
  const ordinal = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(ordinal) ? ordinal : undefined;
};

const currentRapaNuiCalendarDay = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Easter',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(new Date())
    .reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const isNurseStructuralEditWithinWindow = ({ date, remoteData }) => {
  const recordTimestamp = Number(remoteData?.dateTimestamp);
  const now = Date.now();
  if (remoteData?.dateTimestamp != null && Number.isFinite(recordTimestamp)) {
    return now > recordTimestamp - 86_400_000 && now < recordTimestamp + 172_800_000;
  }

  const recordDay = toCalendarDayOrdinal(date);
  const currentDay = toCalendarDayOrdinal(currentRapaNuiCalendarDay());
  if (recordDay === undefined || currentDay === undefined) return false;
  const dayOffset = Math.round((recordDay - currentDay) / 86_400_000);
  return dayOffset >= -1 && dayOffset <= 1;
};

const assertStructuralPatchPolicy = ({ date, policySnapshot, remoteData, role }) => {
  if (!isRayenClinicalWriteFenceActive(policySnapshot)) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Structural daily record patches require the schema-v2 server clinical authority fence.'
    );
  }

  if (role !== 'nurse_hospital') {
    return;
  }

  if (!isNurseStructuralEditWithinWindow({ date, remoteData })) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'The nurse editing window for this daily record has closed.'
    );
  }
};

const assertFullRecordWritePolicy = ({ date, snapshot, record, role }) => {
  if (!snapshot.exists) {
    if (role === 'admin' || role === 'nurse_hospital') return;
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only administrators and hospital nurses can create daily records.'
    );
  }

  if (role === 'admin') return;
  if (
    role === 'nurse_hospital' &&
    Number.isFinite(Number(record?.dateTimestamp)) &&
    isNurseStructuralEditWithinWindow({ date, remoteData: record })
  ) {
    return;
  }

  throw new functions.https.HttpsError(
    'permission-denied',
    role === 'nurse_hospital'
      ? 'The nurse editing window for this daily record has closed.'
      : 'This role must use its scoped daily-record write operation.'
  );
};

const collectChangedPaths = syncContract =>
  Array.isArray(syncContract?.changedPaths)
    ? syncContract.changedPaths
        .filter(path => typeof path === 'string' && path.trim())
        .map(path => path.trim())
    : [];

const resolveCurrentRevision = record => {
  const revision = Number(record?.meta?.revision);
  return Number.isFinite(revision) && revision >= 0 ? revision : 0;
};

const resolveBaseRevision = syncContract => {
  if (
    syncContract?.baseRevision === null ||
    syncContract?.baseRevision === undefined ||
    syncContract?.baseRevision === ''
  ) {
    return undefined;
  }
  const revision = Number(syncContract?.baseRevision);
  return Number.isInteger(revision) && revision >= 0 ? revision : undefined;
};

const assertExpectedRevision = ({ snapshot, syncContract }) => {
  const baseRevision = resolveBaseRevision(syncContract);
  if (baseRevision === undefined || !snapshot.exists) {
    return;
  }

  const currentRevision = resolveCurrentRevision(snapshot.data());
  if (currentRevision !== baseRevision) {
    throw new functions.https.HttpsError(
      'aborted',
      `revision_mismatch: Daily record base revision ${baseRevision} does not match remote revision ${currentRevision}.`
    );
  }
};

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

const toMillis = value => {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : 0;
};

const toIsoTimestamp = value => {
  if (!value) return undefined;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Number.isFinite(value.seconds)) {
    return new Date(
      value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6)
    ).toISOString();
  }
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
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

const assertExpectedVersion = ({ snapshot, expectedLastUpdated }) => {
  if (!expectedLastUpdated || !snapshot.exists) {
    return;
  }

  const remoteLastUpdated = snapshot.data()?.lastUpdated;
  if (!remoteLastUpdated) {
    return;
  }

  const remoteMillis = toMillis(remoteLastUpdated);
  const expectedMillis = toMillis(expectedLastUpdated);
  if (remoteMillis > expectedMillis) {
    throw new functions.https.HttpsError(
      'aborted',
      'Daily record changed remotely before the authorized write transaction.'
    );
  }
};

const assertExactExpectedVersion = ({ snapshot, expectedLastUpdated }) => {
  if (!snapshot.exists || !expectedLastUpdated) {
    throw new functions.https.HttpsError(
      'aborted',
      'Rayen clinical guarded writes require an exact remote version.'
    );
  }
  if (toMillis(snapshot.data()?.lastUpdated) !== toMillis(expectedLastUpdated)) {
    throw new functions.https.HttpsError(
      'aborted',
      'Daily record changed before the guarded Rayen clinical write.'
    );
  }
};

const hasAlreadyAppliedMutation = ({ snapshot, syncContract }) => {
  if (!snapshot.exists) {
    return false;
  }

  const remoteMutationId = normalizeShortString(snapshot.data()?.meta?.lastMutationId);
  const localMutationId = normalizeShortString(syncContract?.mutationId);
  return Boolean(remoteMutationId && localMutationId && remoteMutationId === localMutationId);
};

const assertClinicalAuthority = record => {
  const result = evaluateDailyRecordClinicalAuthority(record);
  return result;
};

const parsePayload = data => {
  const date = assertStringField(data?.date, 'date');
  const record = data?.record;
  if (!isPlainObject(record)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Daily record payload must be an object.'
    );
  }

  if (record.date !== date) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Daily record payload date does not match request date.'
    );
  }

  return {
    date,
    record,
    mode: normalizeMode(data?.mode),
    origin: normalizeOrigin(data?.origin),
    dryRun: data?.dryRun === true,
    syncContract: isPlainObject(data?.syncContract) ? data.syncContract : undefined,
    expectedLastUpdated:
      typeof data?.expectedLastUpdated === 'string' ? data.expectedLastUpdated : undefined,
  };
};

const parsePatchPayload = data => {
  const date = assertStringField(data?.date, 'date');
  const patch = data?.patch;
  const syncContract = isPlainObject(data?.syncContract) ? data.syncContract : undefined;
  if (!isPlainObject(patch) || Object.keys(patch).length === 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Daily record patch payload must be a non-empty object.'
    );
  }

  return {
    date,
    patch,
    mode: normalizeMode(data?.mode),
    origin: normalizeOrigin(data?.origin, 'direct_partial_update'),
    dryRun: data?.dryRun === true,
    syncContract,
    rayenClinicalWriteGuard: parseRayenClinicalWriteGuard(data?.rayenClinicalWriteGuard),
    historyPolicy: data?.historyPolicy === 'skip' ? 'skip' : 'snapshot',
    expectedLastUpdated:
      typeof data?.expectedLastUpdated === 'string'
        ? data.expectedLastUpdated
        : typeof syncContract?.expectedVersion === 'string'
          ? syncContract.expectedVersion
          : undefined,
  };
};

const buildAuthorityResponse = ({
  date,
  mode,
  authority,
  coverage,
  revision,
  mutationId,
  recordState,
}) => {
  const response = {
    success: authority.status === 'ok' || authority.status === 'idempotent',
    date,
    mode,
    authorityStatus: authority.status,
    coverage,
    violations: authority.violations.map(violation => ({
      type: violation.type,
      path: violation.path,
      bedId: violation.bedId,
    })),
  };

  if (Number.isFinite(revision)) {
    response.revision = revision;
  }
  if (mutationId) {
    response.mutationId = mutationId;
  }
  if (recordState) {
    response.recordState = recordState;
  }

  return response;
};

const emptyCoverage = {
  activePatients: 0,
  canonicalEpisodeIds: 0,
  fallbackEpisodeKeys: 0,
  degenerateFallbackEpisodeKeys: 0,
};

const emptyAuthority = {
  status: 'blocked',
  violations: [],
};

const idempotentAuthority = {
  status: 'idempotent',
  violations: [],
};

const recordAuthorityTelemetry = async ({
  firestore,
  date,
  mode,
  origin,
  dryRun,
  authority,
  coverage,
  syncContract,
  status,
  operation = 'saveDailyRecordWithClinicalAuthority',
  errorCode,
  errorMessage,
  startedAt,
}) => {
  try {
    const changedPaths = collectChangedPaths(syncContract);
    const safeAuthority = authority || emptyAuthority;
    const safeCoverage = coverage || emptyCoverage;
    await firestore
      .collection('hospitals')
      .doc(HOSPITAL_ID)
      .collection('functionsTelemetry')
      .add({
        service: 'dailyRecordWriteAuthority',
        operation,
        hospitalId: HOSPITAL_ID,
        durationMs: Date.now() - startedAt,
        attempt: 1,
        totalAttempts: 1,
        status,
        errorCode,
        errorMessage,
        timestamp: new Date().toISOString(),
        context: {
          date,
          mode,
          origin,
          dryRun,
          authorityStatus: safeAuthority.status,
          violationCount: safeAuthority.violations.length,
          violationTypes: safeAuthority.violations.map(violation => violation.type).join(','),
          changedPathsCount: changedPaths.length,
          hasExpectedVersion: Boolean(syncContract?.expectedVersion),
          mutationId: normalizeShortString(syncContract?.mutationId) || null,
          activePatients: safeCoverage.activePatients,
          canonicalEpisodeIds: safeCoverage.canonicalEpisodeIds,
          fallbackEpisodeKeys: safeCoverage.fallbackEpisodeKeys,
          degenerateFallbackEpisodeKeys: safeCoverage.degenerateFallbackEpisodeKeys,
        },
      });
  } catch (error) {
    console.warn(
      'Failed to record daily record authority telemetry',
      sanitizeLogValue({ date, error })
    );
  }
};

const assertAuthorizedDailyRecordWriter = async ({
  context,
  resolveRoleForEmail,
  requiredRole,
}) => {
  const email = requireAuthenticatedEmail(context);
  const resolvedRole = await resolveRoleForEmail(email);

  if (requiredRole && resolvedRole !== requiredRole) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'This daily-record operation requires an administrator.'
    );
  }
  if (!ALLOWED_DAILY_RECORD_WRITE_ROLES.has(resolvedRole)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only authorized clinical users can save daily records.'
    );
  }

  return { email, role: resolvedRole };
};

const assertNoPatientErasures = ({ snapshot, record }) => {
  if (!snapshot.exists) {
    return;
  }
  const erasures = findPatientErasures(snapshot.data() || {}, record);
  if (erasures.length === 0) {
    return;
  }
  const detail = erasures
    .map(erasure => `${erasure.bedId} (${erasure.remotePatientName})`)
    .join(', ');
  throw new functions.https.HttpsError(
    'failed-precondition',
    `La cama ${detail} tiene un paciente en la nube pero está vacía en la copia entrante. ` +
      'El guardado fue bloqueado para evitar pérdida de datos.'
  );
};

const createDailyRecordWriteAuthorityFunctions = ({
  firestore,
  Timestamp,
  resolveRoleForEmail,
}) => ({
  saveDailyRecordWithClinicalAuthority: functions.https.onCall(async (data, context) => {
    const startedAt = Date.now();
    const { email, role } = await assertAuthorizedDailyRecordWriter({
      context,
      resolveRoleForEmail,
    });

    const { date, record, expectedLastUpdated, mode, origin, dryRun, syncContract } =
      parsePayload(data);
    const authority = assertClinicalAuthority(record);
    const coverage = collectClinicalEpisodeCoverage(record);

    if (authority.status !== 'ok') {
      await recordAuthorityTelemetry({
        firestore,
        date,
        mode,
        origin,
        dryRun,
        authority,
        coverage,
        syncContract,
        status: 'failure',
        errorCode: 'failed-precondition',
        errorMessage: 'Daily record clinical authority blocked write.',
        startedAt,
      });
      throw new functions.https.HttpsError(
        'failed-precondition',
        authority.violations.map(violation => violation.message).join(' ')
      );
    }

    const db = firestore;
    const hospitalRef = db.collection('hospitals').doc(HOSPITAL_ID);
    const docRef = hospitalRef.collection('dailyRecords').doc(date);
    const policyRef = hospitalRef.collection('settings').doc('rayenImportPolicy');
    let revision;
    let recordState;
    let responseAuthority = authority;
    let responseCoverage = coverage;

    try {
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(docRef);
        if (hasAlreadyAppliedMutation({ snapshot, syncContract })) {
          const remoteData = snapshot.data() || {};
          responseAuthority = idempotentAuthority;
          responseCoverage = collectClinicalEpisodeCoverage(remoteData);
          revision = resolveCurrentRevision(remoteData);
          recordState = buildAuthorityRecordState({
            record: remoteData,
            lastUpdated: remoteData.lastUpdated,
            meta: remoteData.meta,
          });
          return;
        }

        assertFullRecordWritePolicy({ date, snapshot, record, role });

        assertExpectedVersion({ snapshot, expectedLastUpdated });
        assertExpectedRevision({ snapshot, syncContract });
        assertNoPatientErasures({ snapshot, record });

        const policySnapshot = await transaction.get(policyRef);
        const remoteData = snapshot.exists ? snapshot.data() || {} : {};
        const recordForPersistence = isRayenClinicalWriteFenceActive(policySnapshot)
          ? preserveRayenClinicalFields({ remoteRecord: remoteData, incomingRecord: record })
          : record;
        responseAuthority = assertClinicalAuthority(recordForPersistence);
        responseCoverage = collectClinicalEpisodeCoverage(recordForPersistence);
        if (responseAuthority.status !== 'ok') {
          throw new functions.https.HttpsError(
            'failed-precondition',
            responseAuthority.violations.map(violation => violation.message).join(' ')
          );
        }

        if (dryRun) {
          return;
        }

        const now = Timestamp.now();
        if (snapshot.exists) {
          const historyRef = docRef.collection('history').doc(new Date().toISOString());
          transaction.set(historyRef, {
            ...(snapshot.data() || {}),
            snapshotTimestamp: now,
          });
        }

        const nextMeta = buildNextMeta({
          remoteData,
          syncContract,
          now,
        });
        revision = nextMeta.revision;
        recordState = buildAuthorityRecordState({
          record: recordForPersistence,
          lastUpdated: now,
          meta: nextMeta,
        });
        transaction.set(docRef, {
          ...recordForPersistence,
          meta: nextMeta,
          lastUpdated: now,
        });
      });

      await recordAuthorityTelemetry({
        firestore,
        date,
        mode,
        origin,
        dryRun,
        authority: responseAuthority,
        coverage: responseCoverage,
        syncContract,
        status: 'success',
        startedAt,
      });

      return buildAuthorityResponse({
        date,
        mode,
        authority: responseAuthority,
        coverage: responseCoverage,
        revision,
        mutationId: normalizeShortString(syncContract?.mutationId),
        recordState,
      });
    } catch (error) {
      if (error instanceof functions.https.HttpsError) {
        await recordAuthorityTelemetry({
          firestore,
          date,
          mode,
          origin,
          dryRun,
          authority,
          coverage,
          syncContract,
          status: 'failure',
          errorCode: error.code,
          errorMessage: error.message,
          startedAt,
        });
        throw error;
      }

      console.error(
        'Error saving daily record with clinical authority',
        sanitizeLogValue({ email, date, error })
      );
      throw new functions.https.HttpsError(
        'internal',
        'Failed to save daily record with clinical authority.'
      );
    }
  }),

  patchDailyRecordWithClinicalAuthority: functions.https.onCall(async (data, context) => {
    const startedAt = Date.now();
    const { email, role } = await assertAuthorizedDailyRecordWriter({
      context,
      resolveRoleForEmail,
    });
    const {
      date,
      patch,
      mode,
      origin,
      dryRun,
      syncContract,
      expectedLastUpdated,
      rayenClinicalWriteGuard,
    } = parsePatchPayload(data);
    const db = firestore;
    const hospitalRef = db.collection('hospitals').doc(HOSPITAL_ID);
    const docRef = hospitalRef.collection('dailyRecords').doc(date);
    const policyRef = hospitalRef.collection('settings').doc('rayenImportPolicy');
    const sourceRef =
      rayenClinicalWriteGuard?.recordScope === 'historical'
        ? hospitalRef.collection('dailyRecords').doc(rayenClinicalWriteGuard.sourceDate)
        : docRef;
    let authority;
    let coverage;
    let revision;
    let recordState;
    const mutationId = normalizeShortString(syncContract?.mutationId);
    const guardedHistoryRef = rayenClinicalWriteGuard
      ? docRef.collection('history').doc(`rayen-${rayenClinicalWriteGuard.runId}`)
      : null;

    try {
      await db.runTransaction(async transaction => {
        const [snapshot, policySnapshot, sourceSnapshot, guardedHistorySnapshot] =
          await Promise.all([
            transaction.get(docRef),
            transaction.get(policyRef),
            rayenClinicalWriteGuard?.recordScope === 'historical'
              ? transaction.get(sourceRef)
              : Promise.resolve(null),
            guardedHistoryRef ? transaction.get(guardedHistoryRef) : Promise.resolve(null),
          ]);
        if (!snapshot.exists) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Daily record partial patch requires an existing record.'
          );
        }

        const remoteData = snapshot.data() || {};
        if (hasAlreadyAppliedMutation({ snapshot, syncContract })) {
          authority = idempotentAuthority;
          coverage = collectClinicalEpisodeCoverage(remoteData);
          revision = resolveCurrentRevision(remoteData);
          recordState = buildAuthorityRecordState({
            record: remoteData,
            lastUpdated: remoteData.lastUpdated,
            meta: remoteData.meta,
          });
          return;
        }

        if (rayenClinicalWriteGuard) {
          assertExactExpectedVersion({ snapshot, expectedLastUpdated });
        } else {
          assertExpectedVersion({ snapshot, expectedLastUpdated });
        }
        assertExpectedRevision({ snapshot, syncContract });
        if (rayenClinicalWriteGuard) {
          assertGuardedClinicalPatch({
            patch,
            clinicalFields: RAYEN_CLINICAL_PATCH_FIELDS,
            recordScope: rayenClinicalWriteGuard.recordScope,
          });
          const runRecord =
            rayenClinicalWriteGuard.recordScope === 'historical'
              ? sourceSnapshot?.exists
                ? sourceSnapshot.data() || {}
                : null
              : remoteData;
          assertRayenLegacyClinicalWriteAuthority({
            policySnapshot,
            runRecord,
            targetDate: date,
            guard: rayenClinicalWriteGuard,
            role,
          });
        }
        const patchInspection = inspectAuthorizedPatch({
          remoteData,
          patch,
          role,
          guardedClinicalWrite: Boolean(rayenClinicalWriteGuard),
          guardedRecordScope: rayenClinicalWriteGuard?.recordScope,
        });
        if (isRayenClinicalWriteFenceActive(policySnapshot) && !rayenClinicalWriteGuard) {
          assertNoRayenClinicalOwnedPatch(patch);
        }
        if (patchInspection.requiresStructuralAuthority) {
          assertStructuralPatchPolicy({ date, policySnapshot, remoteData, role });
        }
        const now = Timestamp.now();
        const patchedCandidate = applyPatchToRecord({ date, remoteData, patch });
        const patchedRecord =
          isRayenClinicalWriteFenceActive(policySnapshot) && !rayenClinicalWriteGuard
            ? preserveRayenClinicalFields({
                remoteRecord: remoteData,
                incomingRecord: patchedCandidate,
              })
            : patchedCandidate;
        assertNoPatientErasures({ snapshot, record: patchedRecord });
        patchedRecord.meta = buildNextMeta({ remoteData, syncContract, now });

        authority = assertClinicalAuthority(patchedRecord);
        coverage = collectClinicalEpisodeCoverage(patchedRecord);
        revision = patchedRecord.meta.revision;
        recordState = buildAuthorityRecordState({
          record: patchedRecord,
          lastUpdated: now,
          meta: patchedRecord.meta,
        });

        if (authority.status !== 'ok') {
          throw new functions.https.HttpsError(
            'failed-precondition',
            authority.violations.map(violation => violation.message).join(' ')
          );
        }

        if (dryRun) {
          return;
        }

        if (guardedHistoryRef) {
          if (!guardedHistorySnapshot?.exists) {
            transaction.set(guardedHistoryRef, {
              ...remoteData,
              snapshotTimestamp: now,
            });
          }
        } else {
          const historyRef = docRef.collection('history').doc(new Date().toISOString());
          transaction.set(historyRef, {
            ...remoteData,
            snapshotTimestamp: now,
          });
        }

        transaction.set(docRef, {
          ...patchedRecord,
          lastUpdated: now,
        });
      });

      await recordAuthorityTelemetry({
        firestore,
        date,
        mode,
        origin,
        dryRun,
        authority,
        coverage,
        syncContract,
        operation: 'patchDailyRecordWithClinicalAuthority',
        status: 'success',
        startedAt,
      });

      return buildAuthorityResponse({
        date,
        mode,
        authority,
        coverage,
        revision,
        mutationId,
        recordState,
      });
    } catch (error) {
      if (error instanceof functions.https.HttpsError) {
        await recordAuthorityTelemetry({
          firestore,
          date,
          mode,
          origin,
          dryRun,
          authority,
          coverage,
          syncContract,
          operation: 'patchDailyRecordWithClinicalAuthority',
          status: 'failure',
          errorCode: error.code,
          errorMessage: error.message,
          startedAt,
        });
        throw error;
      }

      console.error(
        'Error patching daily record with clinical authority',
        sanitizeLogValue({ email, date, error })
      );
      throw new functions.https.HttpsError(
        'internal',
        'Failed to patch daily record with clinical authority.'
      );
    }
  }),
});

module.exports = {
  assertAuthorizedDailyRecordWriter,
  createDailyRecordWriteAuthorityFunctions,
};
