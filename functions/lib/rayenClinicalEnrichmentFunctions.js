const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { sanitizeLogValue } = require('./logging/redaction');
const { evaluateDailyRecordClinicalAuthority } = require('./dailyRecordClinicalAuthorityPolicy');
const { assertAuthorizedDailyRecordWriter } = require('./dailyRecordWriteAuthorityFunctions');
const {
  applyClinicalEnrichment,
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
} = require('./rayenClinicalEnrichmentPolicy');

const operation = 'applyRayenClinicalEnrichmentBatch';
const PARITY_CONTRACT_VERSION = 2;

const EMPTY_PARITY_DIAGNOSTICS = Object.freeze({
  mismatchTargetCount: 0,
  mismatchFieldCount: 0,
  mismatchDeviceFieldCount: 0,
  mismatchScoreFieldCount: 0,
  mismatchVitalFieldCount: 0,
  mismatchCheckpointFieldCount: 0,
});

const countFields = patches =>
  patches.reduce((total, target) => total + Object.keys(target.fields).length, 0);

const summarizeRequest = data => {
  const patches = Array.isArray(data?.patches) ? data.patches : [];
  const checkpoints = Array.isArray(data?.checkpoints) ? data.checkpoints : [];
  const targetKeys = new Set(
    [...patches, ...checkpoints].map(
      target =>
        `${String(target?.bedId || '')}|${target?.clinicalCrib === true ? 'crib' : 'patient'}`
    )
  );
  const clinicalKeys = new Set(
    patches.map(
      target =>
        `${String(target?.bedId || '')}|${target?.clinicalCrib === true ? 'crib' : 'patient'}`
    )
  );
  const date =
    typeof data?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : null;
  const mode = data?.mode === 'shadow' || data?.mode === 'enforced' ? data.mode : 'invalid';
  return {
    date,
    mode,
    dryRun: mode === 'shadow',
    targetCount: targetKeys.size,
    clinicalTargetCount: clinicalKeys.size,
    checkpointTargetCount: checkpoints.length,
    checkpointOnlyTargetCount: [...targetKeys].filter(key => !clinicalKeys.has(key)).length,
    fieldCount:
      patches.reduce(
        (total, target) =>
          total +
          (target?.fields && typeof target.fields === 'object' && !Array.isArray(target.fields)
            ? Object.keys(target.fields).length
            : 0),
        0
      ) + checkpoints.length,
    clinicalCribCount: patches.filter(target => target?.clinicalCrib === true).length,
    hasExpectedVersion: typeof data?.expectedLastUpdated === 'string',
    hasBaseRevision: data?.baseRevision !== undefined,
    versionGuardEnforced: mode === 'enforced',
  };
};

const summarizePayload = payload => ({
  date: payload.date,
  mode: payload.mode,
  dryRun: payload.dryRun,
  targetCount: payload.targets.length,
  clinicalTargetCount: payload.patches.length,
  checkpointTargetCount: payload.checkpoints.length,
  checkpointOnlyTargetCount: payload.checkpoints.filter(
    target =>
      !payload.patches.some(
        patch => patch.bedId === target.bedId && patch.clinicalCrib === target.clinicalCrib
      )
  ).length,
  fieldCount: countFields(payload.targets),
  clinicalCribCount: payload.targets.filter(target => target.clinicalCrib).length,
  hasExpectedVersion: Boolean(payload.expectedLastUpdated),
  hasBaseRevision: payload.baseRevision !== undefined,
  versionGuardEnforced: payload.mode === 'enforced',
});

const recordTelemetry = async ({
  firestore,
  requestSummary,
  startedAt,
  status,
  authorityStatus,
  resultParity,
  parityDiagnostics,
  revision,
  error,
}) => {
  try {
    await firestore
      .collection('hospitals')
      .doc(HOSPITAL_ID)
      .collection('functionsTelemetry')
      .add({
        service: 'rayenClinicalEnrichment',
        operation,
        hospitalId: HOSPITAL_ID,
        durationMs: Date.now() - startedAt,
        attempt: 1,
        totalAttempts: 1,
        status,
        errorCode: error?.code || null,
        timestamp: new Date().toISOString(),
        context: {
          ...requestSummary,
          authorityStatus,
          resultParity,
          parityContractVersion: PARITY_CONTRACT_VERSION,
          ...parityDiagnostics,
          revision: Number.isFinite(revision) ? revision : null,
        },
      });
  } catch (telemetryError) {
    console.warn(
      'Failed to record Rayen clinical enrichment telemetry',
      sanitizeLogValue({ date: requestSummary.date, error: telemetryError })
    );
  }
};

const createRayenClinicalEnrichmentFunctions = ({ firestore, Timestamp, resolveRoleForEmail }) => ({
  applyRayenClinicalEnrichmentBatch: functions.https.onCall(async (data, context) => {
    const startedAt = Date.now();
    let requestSummary = summarizeRequest(data);
    let authorityStatus = 'ok';
    let resultParity = 'unavailable';
    let parityDiagnostics = EMPTY_PARITY_DIAGNOSTICS;
    let revision;

    try {
      await assertAuthorizedDailyRecordWriter({ context, resolveRoleForEmail });
      const payload = parseClinicalEnrichmentPayload(data);
      requestSummary = summarizePayload(payload);
      const batchDigest = digestValue({
        date: payload.date,
        patches: payload.patches,
        checkpoints: payload.checkpoints,
      });
      const legacyBatchDigest = buildLegacyClinicalEnrichmentDigest(payload);
      const docRef = firestore
        .collection('hospitals')
        .doc(HOSPITAL_ID)
        .collection('dailyRecords')
        .doc(payload.date);
      await firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(docRef);
        if (!snapshot.exists) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Clinical enrichment requires an existing daily record.'
          );
        }
        const remoteData = snapshot.data() || {};
        const idempotency = classifyIdempotency(remoteData, payload, batchDigest, [
          legacyBatchDigest,
        ]);
        if (idempotency === 'idempotent') {
          authorityStatus = 'idempotent';
          resultParity = 'matched';
          revision = resolveRecordRevision(remoteData);
          return;
        }

        revision = assertRecordRevision(remoteData, payload);
        const nextRecord = applyClinicalEnrichment(remoteData, payload.targets);
        // Shadow runs after the established per-patient writes. Compare against that independently
        // persisted record; comparing with our own projection would certify the request tautologically.
        const parityRecord = payload.dryRun ? remoteData : nextRecord;
        parityDiagnostics = summarizeClinicalEnrichmentMismatches(parityRecord, payload.targets);
        resultParity = parityDiagnostics.mismatchFieldCount === 0 ? 'matched' : 'mismatch';
        if (resultParity !== 'matched' && !payload.dryRun) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Clinical enrichment result did not match the requested batch.'
          );
        }
        const authority = evaluateDailyRecordClinicalAuthority(nextRecord);
        if (authority.status !== 'ok') {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Clinical enrichment would violate daily-record authority.'
          );
        }

        const now = Timestamp.now();
        nextRecord.meta = buildClinicalEnrichmentMeta({
          record: remoteData,
          payload,
          // Keep the receipt readable by the previous callable while instances overlap. The
          // legacy digest still covers every clinical field and embedded checkpoint.
          batchDigest: legacyBatchDigest,
          now,
        });
        // The established authority path also stores a Firestore Timestamp; firestoreShared
        // normalizes it back to the DailyRecord ISO-string contract on every client hydration.
        nextRecord.lastUpdated = now;
        const historySnapshot = {
          ...remoteData,
          snapshotTimestamp: now,
          snapshotReason: 'rayen_clinical_enrichment',
        };
        assertPersistedDocumentSize(nextRecord);
        assertPersistedDocumentSize(historySnapshot);
        if (payload.dryRun) return;

        revision = nextRecord.meta.revision;
        if (payload.patches.length > 0) {
          const historyRef = docRef
            .collection('history')
            .doc(buildHistorySnapshotId(payload.runId));
          transaction.create(historyRef, historySnapshot);
        }
        transaction.set(docRef, nextRecord);
      });

      await recordTelemetry({
        firestore,
        requestSummary,
        startedAt,
        status: 'success',
        authorityStatus,
        resultParity,
        parityDiagnostics,
        revision,
      });
      return {
        success: true,
        date: payload.date,
        mode: payload.mode,
        authorityStatus,
        revision,
        targetCount: payload.targets.length,
        clinicalTargetCount: payload.patches.length,
        checkpointTargetCount: payload.checkpoints.length,
        checkpointOnlyTargetCount: requestSummary.checkpointOnlyTargetCount,
        fieldCount: countFields(payload.targets),
        resultParity,
        patientWrites: authorityStatus === 'ok' && !payload.dryRun ? 1 : 0,
        historySnapshots:
          authorityStatus === 'ok' && !payload.dryRun && payload.patches.length > 0 ? 1 : 0,
      };
    } catch (error) {
      if (context.auth) {
        await recordTelemetry({
          firestore,
          requestSummary,
          startedAt,
          status: 'failure',
          authorityStatus: 'blocked',
          resultParity,
          parityDiagnostics,
          revision,
          error,
        });
      }
      if (error instanceof functions.https.HttpsError) throw error;

      console.error(
        'Error applying Rayen clinical enrichment batch',
        sanitizeLogValue({ date: requestSummary.date, error })
      );
      throw new functions.https.HttpsError(
        'internal',
        'Failed to apply Rayen clinical enrichment batch.'
      );
    }
  }),
});

module.exports = {
  createRayenClinicalEnrichmentFunctions,
};
