const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { requireAuthenticatedEmail } = require('./auth/authPolicies');
const { sanitizeLogValue } = require('./logging/redaction');
const {
  collectClinicalEpisodeCoverage,
  evaluateDailyRecordClinicalAuthority,
} = require('./dailyRecordClinicalAuthorityPolicy');
const { findPatientErasures } = require('./dailyRecordErasureGuard');

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

const FORBIDDEN_PATCH_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

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

const parseAuthorizedPatchPath = path => {
  const parts = String(path)
    .split('.')
    .map(part => part.trim())
    .filter(Boolean);

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

const assertPatchTargetsCurrentClinicalEpisode = ({ remoteData, patch }) => {
  const patchPaths = new Set(Object.keys(patch));
  Object.entries(patch).forEach(([path, value]) => {
    const parsedPath = parseAuthorizedPatchPath(path);
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
  const revision = Number(syncContract?.baseRevision);
  return Number.isFinite(revision) && revision >= 0 ? revision : undefined;
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
    expectedLastUpdated:
      typeof data?.expectedLastUpdated === 'string'
        ? data.expectedLastUpdated
        : typeof syncContract?.expectedVersion === 'string'
          ? syncContract.expectedVersion
          : undefined,
  };
};

const buildAuthorityResponse = ({ date, mode, authority, coverage, revision, mutationId }) => {
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

const assertAuthorizedDailyRecordWriter = async ({ context, resolveRoleForEmail }) => {
  const email = requireAuthenticatedEmail(context);
  const resolvedRole = await resolveRoleForEmail(email);

  if (!ALLOWED_DAILY_RECORD_WRITE_ROLES.has(resolvedRole)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only authorized clinical users can save daily records.'
    );
  }

  return email;
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
    const email = await assertAuthorizedDailyRecordWriter({ context, resolveRoleForEmail });

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
    const docRef = db.collection('hospitals').doc(HOSPITAL_ID).collection('dailyRecords').doc(date);
    let revision;
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
          return;
        }

        assertExpectedVersion({ snapshot, expectedLastUpdated });
        assertExpectedRevision({ snapshot, syncContract });
        assertNoPatientErasures({ snapshot, record });

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
          remoteData: snapshot.exists ? snapshot.data() || {} : {},
          syncContract,
          now,
        });
        revision = nextMeta.revision;
        transaction.set(docRef, {
          ...record,
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
    const email = await assertAuthorizedDailyRecordWriter({ context, resolveRoleForEmail });
    const { date, patch, mode, origin, dryRun, syncContract, expectedLastUpdated } =
      parsePatchPayload(data);
    const db = firestore;
    const docRef = db.collection('hospitals').doc(HOSPITAL_ID).collection('dailyRecords').doc(date);
    let authority;
    let coverage;
    let revision;
    const mutationId = normalizeShortString(syncContract?.mutationId);

    try {
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(docRef);
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
          return;
        }

        assertExpectedVersion({ snapshot, expectedLastUpdated });
        assertExpectedRevision({ snapshot, syncContract });
        assertPatchTargetsCurrentClinicalEpisode({ remoteData, patch });
        const now = Timestamp.now();
        const patchedRecord = applyPatchToRecord({ date, remoteData, patch });
        patchedRecord.meta = buildNextMeta({ remoteData, syncContract, now });

        authority = assertClinicalAuthority(patchedRecord);
        coverage = collectClinicalEpisodeCoverage(patchedRecord);
        revision = patchedRecord.meta.revision;

        if (authority.status !== 'ok') {
          throw new functions.https.HttpsError(
            'failed-precondition',
            authority.violations.map(violation => violation.message).join(' ')
          );
        }

        if (dryRun) {
          return;
        }

        const historyRef = docRef.collection('history').doc(new Date().toISOString());
        transaction.set(historyRef, {
          ...remoteData,
          snapshotTimestamp: now,
        });

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

      return buildAuthorityResponse({ date, mode, authority, coverage, revision, mutationId });
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
