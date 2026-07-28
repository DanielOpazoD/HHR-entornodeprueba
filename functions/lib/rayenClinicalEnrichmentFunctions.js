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
  classifyIdempotency,
  digestValue,
  parseClinicalEnrichmentPayload,
  resolveRecordRevision,
} = require('./rayenClinicalEnrichmentPolicy');

const operation = 'applyRayenClinicalEnrichmentBatch';

const countFields = patches =>
  patches.reduce((total, target) => total + Object.keys(target.fields).length, 0);

const summarizeRequest = data => {
  const patches = Array.isArray(data?.patches) ? data.patches : [];
  const date =
    typeof data?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : null;
  const mode = data?.mode === 'shadow' || data?.mode === 'enforced' ? data.mode : 'invalid';
  return {
    date,
    mode,
    dryRun: mode === 'shadow',
    targetCount: patches.length,
    fieldCount: patches.reduce(
      (total, target) =>
        total +
        (target?.fields && typeof target.fields === 'object' && !Array.isArray(target.fields)
          ? Object.keys(target.fields).length
          : 0),
      0
    ),
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
  targetCount: payload.patches.length,
  fieldCount: countFields(payload.patches),
  clinicalCribCount: payload.patches.filter(target => target.clinicalCrib).length,
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
    let revision;

    try {
      await assertAuthorizedDailyRecordWriter({ context, resolveRoleForEmail });
      const payload = parseClinicalEnrichmentPayload(data);
      requestSummary = summarizePayload(payload);
      const batchDigest = digestValue({ date: payload.date, patches: payload.patches });
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
        const idempotency = classifyIdempotency(remoteData, payload, batchDigest);
        if (idempotency === 'idempotent') {
          authorityStatus = 'idempotent';
          revision = resolveRecordRevision(remoteData);
          return;
        }

        revision = assertRecordRevision(remoteData, payload);
        const nextRecord = applyClinicalEnrichment(remoteData, payload.patches);
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
          batchDigest,
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
        const historyRef = docRef.collection('history').doc(buildHistorySnapshotId(payload.runId));
        transaction.create(historyRef, historySnapshot);
        transaction.set(docRef, nextRecord);
      });

      await recordTelemetry({
        firestore,
        requestSummary,
        startedAt,
        status: 'success',
        authorityStatus,
        revision,
      });
      return {
        success: true,
        date: payload.date,
        mode: payload.mode,
        authorityStatus,
        revision,
        targetCount: payload.patches.length,
        fieldCount: countFields(payload.patches),
      };
    } catch (error) {
      if (context.auth) {
        await recordTelemetry({
          firestore,
          requestSummary,
          startedAt,
          status: 'failure',
          authorityStatus: 'blocked',
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
