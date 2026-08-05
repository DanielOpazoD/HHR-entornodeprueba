const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { sanitizeLogValue } = require('./logging/redaction');
const { evaluateDailyRecordClinicalAuthority } = require('./dailyRecordClinicalAuthorityPolicy');
const { assertAuthorizedDailyRecordWriter } = require('./dailyRecordWriteAuthorityFunctions');
const {
  assertRayenClinicalBatchAuthority,
  assertRayenClinicalRunAuthority,
} = require('./rayenClinicalBatchAuthority');
const {
  applyClinicalEnrichment,
  assertHistoricalCudyrPayload,
  assertPersistedDocumentSize,
  assertLegacyReplayRevision,
  assertRecordRevision,
  buildClinicalEnrichmentMeta,
  buildHistorySnapshotId,
  buildLegacyClinicalEnrichmentDigest,
  classifyIdempotency,
  clinicalEnrichmentMatches,
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
    fieldContractVersion: data?.fieldContractVersion === 2 ? 2 : 1,
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
  fieldContractVersion: payload.fieldContractVersion,
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
  policyRevision,
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
          policyRevision: Number.isFinite(policyRevision) ? policyRevision : null,
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
    let policyRevision;

    try {
      const payload = parseClinicalEnrichmentPayload(data);
      const { role: writerRole } = await assertAuthorizedDailyRecordWriter({
        context,
        resolveRoleForEmail,
      });
      requestSummary = summarizePayload(payload);
      const batchDigest = digestValue({
        date: payload.date,
        authorityDate: payload.authorityDate,
        patches: payload.patches,
        checkpoints: payload.checkpoints,
      });
      const legacyBatchDigest = buildLegacyClinicalEnrichmentDigest(payload);
      const hospitalRef = firestore.collection('hospitals').doc(HOSPITAL_ID);
      const policyRef = hospitalRef.collection('settings').doc('rayenImportPolicy');
      const docRef = hospitalRef.collection('dailyRecords').doc(payload.date);
      const authorityRef = hospitalRef.collection('dailyRecords').doc(payload.authorityDate);
      const transactionOutcome = await firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(docRef);
        if (!snapshot.exists) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Clinical enrichment requires an existing daily record.'
          );
        }
        const remoteData = snapshot.data() || {};
        const authoritySnapshot =
          payload.authorityDate === payload.date ? snapshot : await transaction.get(authorityRef);
        if (!authoritySnapshot.exists) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Clinical enrichment requires the synchronization run record.'
          );
        }
        if (payload.legacyAuthorityInference !== true) {
          const { sourceDate } = assertRayenClinicalRunAuthority({
            record: authoritySnapshot.data() || {},
            payload,
          });
          if (payload.date !== sourceDate && writerRole !== 'admin') {
            throw new functions.https.HttpsError(
              'permission-denied',
              'This daily-record operation requires an administrator.'
            );
          }
        }
        const idempotency = classifyIdempotency(remoteData, payload, batchDigest, [
          legacyBatchDigest,
        ]);
        if (idempotency.status === 'idempotent') {
          authorityStatus = 'idempotent';
          resultParity = 'matched';
          revision = resolveRecordRevision(remoteData);
          return { historySnapshotWritten: false };
        }

        assertHistoricalCudyrPayload(remoteData, payload);
        const policySnapshot = await transaction.get(policyRef);
        // A lost response may be retried after an administrator changes the policy. An exact
        // receipt proves that mutation already committed; only new/legacy-replay work must satisfy
        // the current authority fence.
        const batchAuthority = assertRayenClinicalBatchAuthority({
          policySnapshot,
          record: authoritySnapshot.data() || {},
          payload,
        });
        policyRevision = batchAuthority.policyRevision;
        if (payload.date !== batchAuthority.sourceDate && writerRole !== 'admin') {
          throw new functions.https.HttpsError(
            'permission-denied',
            'This daily-record operation requires an administrator.'
          );
        }

        revision =
          idempotency.status === 'legacy-replay'
            ? assertLegacyReplayRevision(remoteData, payload, idempotency.receipt)
            : assertRecordRevision(remoteData, payload);
        if (clinicalEnrichmentMatches(remoteData, payload.targets, payload.fieldContractVersion)) {
          // Reuse the established status so older clients remain compatible
          // while the callable rolls out. A new canonical no-op is accepted only after proving
          // that its base revision still describes the remote record; exact receipts returned
          // above remain the sole path that may bypass mutable authority state.
          authorityStatus = 'idempotent';
          resultParity = 'matched';
          return { historySnapshotWritten: false };
        }
        const shouldCaptureHistorySnapshot =
          payload.patches.length > 0 && idempotency.status !== 'legacy-replay';
        const historyRef = shouldCaptureHistorySnapshot
          ? docRef.collection('history').doc(buildHistorySnapshotId(payload.runId))
          : null;
        const historyRefSnapshot = historyRef ? await transaction.get(historyRef) : null;
        const nextRecord = applyClinicalEnrichment(
          remoteData,
          payload.targets,
          payload.fieldContractVersion
        );
        // Shadow runs after the established per-patient writes. Compare against that independently
        // persisted record; comparing with our own projection would certify the request tautologically.
        const parityRecord = payload.dryRun ? remoteData : nextRecord;
        parityDiagnostics = summarizeClinicalEnrichmentMismatches(
          parityRecord,
          payload.targets,
          payload.fieldContractVersion
        );
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
          canonicalDigest: batchDigest,
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
        if (payload.dryRun) return { historySnapshotWritten: false };

        revision = nextRecord.meta.revision;
        const historySnapshotWritten =
          shouldCaptureHistorySnapshot && historyRefSnapshot?.exists !== true;
        if (historySnapshotWritten && historyRef) {
          transaction.create(historyRef, historySnapshot);
        }
        transaction.set(docRef, nextRecord);
        return { historySnapshotWritten };
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
        policyRevision,
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
        historySnapshots: transactionOutcome.historySnapshotWritten ? 1 : 0,
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
          policyRevision,
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
