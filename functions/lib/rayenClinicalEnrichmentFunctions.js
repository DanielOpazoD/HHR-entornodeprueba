const functions = require('firebase-functions/v1');
// Retain the original endpoint for already-loaded clients during the regional rollout.
const clinicalFunctions = functions
  .region('us-central1', 'southamerica-east1')
  .runWith({ memory: '1GB' });
const { performance } = require('node:perf_hooks');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { sanitizeLogValue } = require('./logging/redaction');
const { evaluateDailyRecordClinicalAuthority } = require('./dailyRecordClinicalAuthorityPolicy');
const { assertAuthorizedDailyRecordWriter } = require('./dailyRecordWriteAuthorityFunctions');
const {
  protectSpecialtyDecisions,
  SpecialtyDecisionError,
} = require('./specialtyDecisionContract');
const { applyPendingSpecialtyRules, isCurrentRapaNuiDay } = require('./specialtyRules');
const {
  assertTrustedSpecialtyAssignments,
  assertUnusedSpecialtyDecisionIds,
} = require('./specialtyAuditAuthority');
const {
  assertRayenClinicalBatchAuthority,
  assertRayenClinicalRunAuthority,
} = require('./rayenClinicalBatchAuthority');
const { createClinicalDerivedStore, isClinicalDerivedSplitDay } = require('./clinicalDerivedStore');
const { wholeRecordFieldWrites } = require('./dailyRecordFieldWrites');
const {
  applyClinicalEnrichment,
  assertHistoricalCudyrPayload,
  assertAdministrativeCudyrAuthority,
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
  resolveHistoricalCudyrTargets,
  summarizeClinicalEnrichmentMismatches,
} = require('./rayenClinicalEnrichmentPolicy');

const { assertDocumentaryCudyrAuthority } = require('./rayenDocumentaryCudyrPolicy');
const { answerClinicalBatchWarmup, isClinicalBatchWarmup } = require('./rayenClinicalBatchWarmup');
const { recordTelemetry } = require('./rayenClinicalEnrichmentTelemetry');
const {
  PARITY_CONTRACT_VERSION,
  UNSPLIT_PARITY_CONTRACT_VERSION,
  EMPTY_PARITY_DIAGNOSTICS,
  countFields,
  resolveTargetScope,
  buildPersistenceFailureDetails,
  summarizeRequest,
  summarizePayload,
  createEnrichmentTimingTracker,
} = require('./rayenClinicalEnrichmentSummary');

const createRayenClinicalEnrichmentFunctions = ({
  firestore,
  Timestamp,
  FieldValue,
  resolveRoleForEmail,
  monotonicNow = () => performance.now(),
}) => ({
  applyRayenClinicalEnrichmentBatch: clinicalFunctions.https.onCall(async (data, context) => {
    if (isClinicalBatchWarmup(data)) {
      return answerClinicalBatchWarmup({ context, resolveRoleForEmail });
    }
    const startedAt = Date.now();
    const clinicalDerived = createClinicalDerivedStore({ FieldValue });
    const timing = createEnrichmentTimingTracker(monotonicNow);
    let requestSummary = summarizeRequest(data);
    let authorityStatus = 'ok';
    let resultParity = 'unavailable';
    let parityContractVersion = UNSPLIT_PARITY_CONTRACT_VERSION;
    let parityDiagnostics = EMPTY_PARITY_DIAGNOSTICS;
    let revision;
    let policyRevision;
    let transactionAttempts = 0;

    try {
      const payload = parseClinicalEnrichmentPayload(data);
      const { role: writerRole } = await assertAuthorizedDailyRecordWriter({
        context,
        resolveRoleForEmail,
      });
      timing.finishPhase('authorizationMs');
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
      const specialtyPolicyRef = hospitalRef.collection('specialtyPolicies').doc('active');
      const docRef = hospitalRef.collection('dailyRecords').doc(payload.date);
      const authorityRef = hospitalRef.collection('dailyRecords').doc(payload.authorityDate);
      timing.startTransaction();
      const transactionOutcome = await firestore.runTransaction(async transaction => {
        transactionAttempts += 1;
        // Split counters describe this attempt only.
        requestSummary = summarizePayload(payload);
        const callbackStartedAt = monotonicNow();
        const read = reference =>
          timing.measureTransactionOperation('documentReadMs', () => transaction.get(reference));
        try {
          let snapshot;
          let authoritySnapshot;
          if (payload.authorityDate === payload.date) {
            snapshot = await read(docRef);
            authoritySnapshot = snapshot;
          } else {
            [snapshot, authoritySnapshot] = await timing.measureTransactionOperation(
              'documentReadMs',
              () => Promise.all([transaction.get(docRef), transaction.get(authorityRef)])
            );
          }
          if (!snapshot.exists) {
            throw new functions.https.HttpsError(
              'failed-precondition',
              'Clinical enrichment requires an existing daily record.'
            );
          }
          const remoteData = snapshot.data() || {};
          // Phase 1a split (clinicalDerivedStore): null unless moved fields go to a split day.
          const derived = await clinicalDerived.prepareBatchSplit({
            get: read,
            dayRef: docRef,
            remoteData,
            payload,
          });
          const view = derived?.view ?? remoteData;
          parityContractVersion =
            isClinicalDerivedSplitDay(remoteData) || derived
              ? PARITY_CONTRACT_VERSION
              : UNSPLIT_PARITY_CONTRACT_VERSION;
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
            if (payload.date !== sourceDate && !['admin', 'nurse_hospital'].includes(writerRole)) {
              throw new functions.https.HttpsError(
                'permission-denied',
                'Historical CUDYR synchronization requires an administrator or hospital nurse.'
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
          // Split counters only once a receipt no longer answers, as in the other two callables.
          if (derived) requestSummary = { ...requestSummary, ...derived.telemetry };
          derived?.assertSupported();

          assertHistoricalCudyrPayload(remoteData, payload);
          const [policySnapshot, specialtyPolicySnapshot] =
            process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT === 'enabled'
              ? await timing.measureTransactionOperation('documentReadMs', () =>
                  Promise.all([transaction.get(policyRef), transaction.get(specialtyPolicyRef)])
                )
              : [await read(policyRef), null];
          // A lost response may be retried after an administrator changes the policy. An exact
          // receipt proves that mutation already committed; only new/legacy-replay work must satisfy
          // the current authority fence.
          const batchAuthority = assertRayenClinicalBatchAuthority({
            policySnapshot,
            record: authoritySnapshot.data() || {},
            payload,
          });
          policyRevision = batchAuthority.policyRevision;
          if (
            payload.date !== batchAuthority.sourceDate &&
            !['admin', 'nurse_hospital'].includes(writerRole)
          ) {
            throw new functions.https.HttpsError(
              'permission-denied',
              'Historical CUDYR synchronization requires an administrator or hospital nurse.'
            );
          }

          revision =
            idempotency.status === 'legacy-replay'
              ? assertLegacyReplayRevision(remoteData, payload, idempotency.receipt)
              : assertRecordRevision(remoteData, payload);
          assertAdministrativeCudyrAuthority(remoteData, payload);
          await assertDocumentaryCudyrAuthority({
            payload,
            record: remoteData,
            hospitalRef,
            read,
            authorityRecord: authoritySnapshot.data() || {},
            valuesEqual: (left, right) => digestValue(left) === digestValue(right),
          });
          const effectiveTargets = resolveHistoricalCudyrTargets(remoteData, payload);
          if (clinicalEnrichmentMatches(view, effectiveTargets, payload.fieldContractVersion)) {
            // Reuse the established status so older clients remain compatible
            // while the callable rolls out. A new canonical no-op is accepted only after proving
            // that its base revision still describes the remote record; exact receipts returned
            // above remain the sole path that may bypass mutable authority state.
            authorityStatus = 'idempotent';
            resultParity = 'matched';
            return { historySnapshotWritten: false };
          }
          // D7 fence after the canonical no-op: only a request that would write meets it.
          derived?.assertAccepted(data);
          const shouldCaptureHistorySnapshot =
            payload.patches.length > 0 && idempotency.status !== 'legacy-replay';
          const historyRef = shouldCaptureHistorySnapshot
            ? docRef.collection('history').doc(buildHistorySnapshotId(payload.runId))
            : null;
          const historyRefSnapshot = historyRef ? await read(historyRef) : null;
          const nextRecord = applyClinicalEnrichment(
            view,
            effectiveTargets,
            payload.fieldContractVersion
          );
          await timing.measureTransactionOperation('specialtyAuditMs', () =>
            assertTrustedSpecialtyAssignments({
              transaction,
              hospitalRef,
              records: [remoteData],
            })
          );
          protectSpecialtyDecisions({
            remoteRecord: remoteData,
            candidate: nextRecord,
            guardScalarChanges: process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT === 'enabled',
          });
          const automaticSpecialtyDecisions =
            process.env.HHR_SPECIALTY_EPISODE_ASSIGNMENT === 'enabled'
              ? applyPendingSpecialtyRules({
                  catalogEnabled: isCurrentRapaNuiDay(payload.date),
                  remoteRecord: remoteData,
                  candidate: nextRecord,
                  policy: specialtyPolicySnapshot?.exists ? specialtyPolicySnapshot.data() : null,
                  actorUid: context.auth?.uid,
                  mutationId: payload.mutationId,
                  now: new Date().toISOString(),
                  eligibleBedIds: [...new Set(effectiveTargets.map(target => target.bedId))],
                })
              : [];
          await timing.measureTransactionOperation('specialtyAuditMs', () =>
            assertUnusedSpecialtyDecisionIds({
              transaction,
              docRef,
              decisions: automaticSpecialtyDecisions,
            })
          );
          parityDiagnostics = summarizeClinicalEnrichmentMismatches(
            nextRecord,
            effectiveTargets,
            payload.fieldContractVersion
          );
          resultParity = parityDiagnostics.mismatchFieldCount === 0 ? 'matched' : 'mismatch';
          if (resultParity !== 'matched') {
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
          const writer = { mutationId: payload.mutationId, policySnapshot };
          nextRecord.meta.fieldWrites = wholeRecordFieldWrites(nextRecord, remoteData, writer);
          // The established authority path also stores a Firestore Timestamp; firestoreShared
          // normalizes it back to the DailyRecord ISO-string contract on every client hydration.
          nextRecord.lastUpdated = now;
          const derivedWrite = derived?.finalize({ record: nextRecord, now });
          const persistedRecord = derivedWrite?.persistedRecord ?? nextRecord;
          const runCopy = {
            ...remoteData,
            snapshotTimestamp: now,
            snapshotReason: 'rayen_clinical_enrichment',
          };
          const historySnapshot =
            derivedWrite && historyRef ? derivedWrite.withRunPrevious(runCopy) : runCopy;
          assertPersistedDocumentSize(persistedRecord);
          assertPersistedDocumentSize(historySnapshot);

          revision = nextRecord.meta.revision;
          const historySnapshotWritten =
            shouldCaptureHistorySnapshot && historyRefSnapshot?.exists !== true;
          if (historySnapshotWritten && historyRef) {
            transaction.create(historyRef, historySnapshot);
          } else if (historyRef) {
            derivedWrite?.extendRunCopy({
              transaction,
              ref: historyRef,
              snapshot: historyRefSnapshot,
            });
          }
          transaction.set(docRef, persistedRecord);
          derivedWrite?.writeDocs(transaction);
          automaticSpecialtyDecisions.forEach(decision => {
            transaction.set(
              docRef.collection('specialtyDecisions').doc(decision.decisionId),
              decision
            );
          });
          return { historySnapshotWritten };
        } finally {
          timing.recordCallbackDuration(callbackStartedAt);
        }
      });

      timing.finishPhase('transactionMs');
      timing.finalizeTransactionTimings();
      timing.beginPhase('telemetryMs');
      const transactionTimingsMs = timing.getTransactionTimings();
      await recordTelemetry({
        firestore,
        requestSummary,
        startedAt,
        status: 'success',
        serverTimingsMs: { ...timing.serverTimingsMs },
        transactionTimingsMs,
        authorityStatus,
        resultParity,
        parityContractVersion,
        parityDiagnostics,
        revision,
        policyRevision,
        transactionAttempts,
      });
      timing.finishPhase('telemetryMs');
      timing.finishHandler();
      return {
        success: true,
        serverTimingsMs: timing.serverTimingsMs,
        transactionTimingsMs,
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
        patientWrites: authorityStatus === 'ok' ? 1 : 0,
        historySnapshots: transactionOutcome.historySnapshotWritten ? 1 : 0,
        targetScope: resolveTargetScope(payload),
        transactionAttempts,
        transactionRetries: Math.max(0, transactionAttempts - 1),
      };
    } catch (error) {
      timing.finishActivePhase();
      timing.finalizeTransactionTimings();
      const transactionTimingsMs = timing.getTransactionTimings();
      const handledError =
        error instanceof SpecialtyDecisionError
          ? new functions.https.HttpsError(error.code, error.message, error.details)
          : error;
      if (context.auth) {
        timing.beginPhase('telemetryMs');
        await recordTelemetry({
          firestore,
          requestSummary,
          startedAt,
          status: 'failure',
          serverTimingsMs: { ...timing.serverTimingsMs },
          transactionTimingsMs,
          authorityStatus: 'blocked',
          resultParity,
          parityContractVersion,
          parityDiagnostics,
          revision,
          policyRevision,
          transactionAttempts,
          error: handledError,
        });
        timing.finishPhase('telemetryMs');
      }
      timing.finishHandler();
      const failureDetails = {
        ...buildPersistenceFailureDetails(requestSummary, transactionAttempts),
        serverTimingsMs: timing.serverTimingsMs,
        ...(transactionTimingsMs ? { transactionTimingsMs } : {}),
      };
      if (handledError instanceof functions.https.HttpsError) {
        throw new functions.https.HttpsError(handledError.code, handledError.message, {
          ...(error instanceof SpecialtyDecisionError ? error.details : {}),
          ...failureDetails,
        });
      }

      console.error(
        'Error applying Rayen clinical enrichment batch',
        sanitizeLogValue({ date: requestSummary.date, error: handledError })
      );
      throw new functions.https.HttpsError(
        'internal',
        'Failed to apply Rayen clinical enrichment batch.',
        failureDetails
      );
    }
  }),
});

module.exports = {
  createRayenClinicalEnrichmentFunctions,
};
