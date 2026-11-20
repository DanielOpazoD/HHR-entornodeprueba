// patchDailyRecordWithClinicalAuthority: one transaction that writes only the patched paths.
const functions = require('firebase-functions/v1');
const {
  resolveCurrentRevision,
  assertExpectedRevision,
  assertExpectedVersion,
  assertVerifiableWriteBase,
  assertExactExpectedVersion,
} = require('./dailyRecordWriteVersionGuards');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { createClinicalDerivedStore } = require('./clinicalDerivedStore');
const { sanitizeLogValue } = require('./logging/redaction');
const { collectClinicalEpisodeCoverage } = require('./dailyRecordClinicalAuthorityPolicy');
const { protectSpecialtyDecisions, getPatient } = require('./specialtyDecisionContract');
const { applyPendingSpecialtyRules, isCurrentRapaNuiDay } = require('./specialtyRules');
const {
  assertTrustedSpecialtyAssignments,
  assertUnusedSpecialtyDecisionIds,
} = require('./specialtyAuditAuthority');
const { buildJevEvidence } = require('./specialtyJevEvidence');
const {
  RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
  isRayenClinicalWriteFenceActive,
  preserveRayenClinicalFields,
} = require('./dailyRecordClinicalFieldPreservation');
const { normalizeShortString, parsePatchPayload } = require('./dailyRecordWriteRequest');
const {
  assertAuthorizedDailyRecordWriter,
  assertClinicalAuthority,
  assertNoPatientErasures,
  assertNoPersistedEpisodeDowngrades,
  assertNoRayenClinicalOwnedPatch,
  assertNursePatchWindow,
  assertStructuralPatchPolicy,
  inspectAuthorizedPatch,
  specialtyEpisodeEnabled,
} = require('./dailyRecordWritePolicy');
const { assertIntentionalBedClearRequest } = require('./dailyRecordIntentionalBedClear');
const {
  applyPatchToRecord,
  buildAuthorityRecordState,
  buildNextMeta,
  buildSlimHistorySnapshot,
  hasAlreadyAppliedMutation,
  readValueAtPath,
  specialtyFieldSnapshot,
} = require('./dailyRecordWriteRecordState');
const {
  asSpecialtyHttpsError,
  buildAuthorityResponse,
  idempotentAuthority,
  recordAuthorityTelemetry,
} = require('./dailyRecordAuthorityOutcome');

const createPatchHandler =
  ({ firestore, Timestamp, FieldValue, resolveRoleForEmail, assertPatchBase }) =>
  async (data, context) => {
    const startedAt = Date.now();
    const { email, role } = await assertAuthorizedDailyRecordWriter({
      context,
      resolveRoleForEmail,
    });
    const authMs = Date.now() - startedAt;
    let txnStartedAt = 0;
    let txnMs = 0;
    let txnAttempts = 0;
    let historyMs = 0;
    let pendingHistoryData = null;
    const buildTimings = () => ({
      authMs,
      txnMs: txnMs || (txnStartedAt ? Date.now() - txnStartedAt : 0),
      txnAttempts,
      historyMs,
    });
    const {
      date,
      patch,
      mode,
      origin,
      dryRun,
      syncContract,
      expectedLastUpdated,
      intentionalBedClear,
      specialtyIntent,
    } = parsePatchPayload(data);
    const db = firestore;
    const hospitalRef = db.collection('hospitals').doc(HOSPITAL_ID);
    const docRef = hospitalRef.collection('dailyRecords').doc(date);
    const policyRef = hospitalRef.collection('settings').doc('rayenImportPolicy');
    const specialtyPolicyRef = hospitalRef.collection('specialtyPolicies').doc('active');
    const aiRequestRef =
      specialtyIntent?.kind === 'accept_ai'
        ? hospitalRef.collection('specialtyAiRequests').doc(specialtyIntent.requestId)
        : null;
    let authority;
    let coverage;
    let revision;
    let recordState;
    let clinicalDerivedTelemetry;
    const clinicalDerived = createClinicalDerivedStore({ FieldValue });
    const mutationId = normalizeShortString(syncContract?.mutationId);

    try {
      txnStartedAt = Date.now();
      await db.runTransaction(async transaction => {
        txnAttempts += 1;
        pendingHistoryData = null;
        clinicalDerivedTelemetry = undefined;
        const [snapshot, policySnapshot, specialtyPolicySnapshot, aiRequestSnapshot] =
          await Promise.all([
            transaction.get(docRef),
            transaction.get(policyRef),
            specialtyEpisodeEnabled() ? transaction.get(specialtyPolicyRef) : Promise.resolve(null),
            aiRequestRef ? transaction.get(aiRequestRef) : Promise.resolve(null),
          ]);
        if (!snapshot.exists) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Daily record partial patch requires an existing record.'
          );
        }

        if (assertPatchBase) await assertPatchBase(snapshot, data, transaction);
        const remoteData = snapshot.data() || {};
        if (
          hasAlreadyAppliedMutation({
            snapshot,
            syncContract,
            values: patch,
            uid: context.auth?.uid,
          })
        ) {
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

        if (!dryRun) assertVerifiableWriteBase({ snapshot, syncContract, expectedLastUpdated });
        if (intentionalBedClear) {
          assertExactExpectedVersion({ snapshot, expectedLastUpdated });
        } else {
          assertExpectedVersion({ snapshot, expectedLastUpdated });
        }
        assertExpectedRevision({ snapshot, syncContract });
        await assertTrustedSpecialtyAssignments({
          transaction,
          hospitalRef,
          records: [remoteData],
        });
        if (specialtyIntent && specialtyEpisodeEnabled() && !specialtyPolicySnapshot?.exists) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Specialty policy must be published before clinical decisions.'
          );
        }
        let aiDecision = null;
        if (specialtyIntent?.kind === 'accept_ai') {
          const request = aiRequestSnapshot?.exists ? aiRequestSnapshot.data() : null;
          const policy = specialtyPolicySnapshot?.exists ? specialtyPolicySnapshot.data() : null;
          const patient = getPatient(remoteData, specialtyIntent.bedId, specialtyIntent.target);
          let digest = null;
          try {
            digest = buildJevEvidence({
              date,
              bedId: specialtyIntent.bedId,
              target: specialtyIntent.target,
              patient,
              policy,
            })?.digest;
          } catch {
            /* Invalid catalog or evidence fails closed. */
          }
          if (
            !specialtyEpisodeEnabled() ||
            process.env.HHR_JEV_CLINICAL_APPROVED !== 'enabled' ||
            !isCurrentRapaNuiDay(date) ||
            policy?.aiMode !== 'consultative' ||
            !request ||
            request.status !== 'complete' ||
            request.requesterUid !== context.auth?.uid ||
            request.date !== date ||
            request.bedId !== specialtyIntent.bedId ||
            request.target !== specialtyIntent.target ||
            request.episodeId !== specialtyIntent.episodeId ||
            request.policyRevision !== policy.revision ||
            request.digest !== digest ||
            !digest ||
            !Number.isFinite(Date.parse(request.expiresAt)) ||
            Date.parse(request.expiresAt) <= Date.now() ||
            request.result?.specialty !== specialtyIntent.value ||
            request.result?.choice === 'review_required'
          ) {
            throw new functions.https.HttpsError(
              'aborted',
              'Jev suggestion is stale or unavailable.'
            );
          }
          aiDecision = {
            requestId: specialtyIntent.requestId,
            model: request.result.model,
            promptVersion: request.result.promptVersion,
          };
        }
        const canonicalIntentionalBedClearPatch = assertIntentionalBedClearRequest({
          patch,
          role,
          expectedLastUpdated,
          intentionalBedClear,
          remoteData,
        });
        const authorizedPatch = canonicalIntentionalBedClearPatch || patch;
        const patchInspection = inspectAuthorizedPatch({
          remoteData,
          patch: authorizedPatch,
          role,
          intentionalBedClear,
        });
        if (isRayenClinicalWriteFenceActive(policySnapshot) && !intentionalBedClear) {
          assertNoRayenClinicalOwnedPatch(patch);
        }
        if (patchInspection.requiresStructuralAuthority) {
          assertStructuralPatchPolicy({ policySnapshot });
        }
        assertNursePatchWindow({ date, role });
        // Phase 1a split (clinicalDerivedStore): null unless moved fields go to a split day.
        const derivedSplit = await clinicalDerived.preparePatchSplit({
          transaction,
          dayRef: docRef,
          date,
          remoteData,
          patch: authorizedPatch,
          data,
        });
        clinicalDerivedTelemetry = derivedSplit?.telemetry;
        const now = Timestamp.now();
        const patchedCandidate = applyPatchToRecord({
          date,
          remoteData,
          patch: authorizedPatch,
        });
        const patchedRecord =
          isRayenClinicalWriteFenceActive(policySnapshot) && !intentionalBedClear
            ? preserveRayenClinicalFields({
                remoteRecord: remoteData,
                incomingRecord: patchedCandidate,
                // Los dispositivos editados a mano ya pasaron la valla: solo
                // se restauran las mediciones exclusivas del lote.
                fields: RAYEN_BATCH_ONLY_CLINICAL_FIELDS,
              })
            : patchedCandidate;
        const specialtyFieldsBefore = specialtyFieldSnapshot(patchedRecord);
        const specialtyDecisions = protectSpecialtyDecisions({
          remoteRecord: remoteData,
          candidate: patchedRecord,
          intent: specialtyEpisodeEnabled() ? specialtyIntent : null,
          patch: authorizedPatch,
          actorUid: context.auth?.uid,
          mutationId: syncContract?.mutationId,
          now: new Date().toISOString(),
          aiDecision,
          guardScalarChanges: specialtyEpisodeEnabled(),
        });
        if (!specialtyEpisodeEnabled() && specialtyIntent) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Specialty episode mode is disabled.'
          );
        }
        const automaticSpecialtyDecisions =
          specialtyEpisodeEnabled() && !specialtyIntent
            ? applyPendingSpecialtyRules({
                catalogEnabled: isCurrentRapaNuiDay(date),
                remoteRecord: remoteData,
                candidate: patchedRecord,
                policy: specialtyPolicySnapshot?.exists ? specialtyPolicySnapshot.data() : null,
                actorUid: context.auth?.uid,
                mutationId: syncContract?.mutationId,
                now: new Date().toISOString(),
                eligibleBedIds: [
                  ...new Set(
                    Object.keys(authorizedPatch)
                      .filter(path => path.startsWith('beds.'))
                      .map(path => path.split('.')[1])
                  ),
                ],
              })
            : [];
        await assertUnusedSpecialtyDecisionIds({
          transaction,
          docRef,
          decisions: [...specialtyDecisions, ...automaticSpecialtyDecisions],
        });
        assertNoPatientErasures({
          snapshot,
          record: patchedRecord,
          intentionalBedClear,
        });
        assertNoPersistedEpisodeDowngrades({ snapshot, record: patchedRecord });
        // The fields this write stores: the patch and the specialty fields the server changed.
        const writtenPaths = [
          ...Object.keys(authorizedPatch),
          ...[...specialtyFieldSnapshot(patchedRecord)]
            .filter(
              ([path, value]) =>
                specialtyFieldsBefore.get(path) !== value &&
                !Object.keys(authorizedPatch).some(
                  patchedPath => path === patchedPath || path.startsWith(`${patchedPath}.`)
                )
            )
            .map(([path]) => path),
        ];
        patchedRecord.meta = buildNextMeta({
          remoteData,
          syncContract,
          now,
          record: patchedRecord,
          writtenPaths,
          fenced: isRayenClinicalWriteFenceActive(policySnapshot),
          writerUid: context.auth?.uid,
        });
        const derivedWrite = derivedSplit?.plan({ patchedRecord, now, mutationId });

        authority = assertClinicalAuthority(patchedRecord);
        coverage = collectClinicalEpisodeCoverage(patchedRecord);
        revision = patchedRecord.meta.revision;
        recordState = buildAuthorityRecordState({
          // D8: on a split day, the day exactly as persisted (never an overlaid record).
          record: derivedWrite?.persistedRecord ?? patchedRecord,
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

        // El snapshot de historial se escribe después del commit y adelgazado.
        pendingHistoryData = buildSlimHistorySnapshot(remoteData, now);

        // Escribir sólo los paths tocados (con sus valores FINALES, ya
        // canonicalizados en patchedRecord) en lugar de reescribir el registro
        // completo (~0,5MB): el documento resultante es idéntico al set()
        // anterior y el payload de la transacción baja de cientos de KB a KBs.
        const txnUpdate = { date, meta: patchedRecord.meta, lastUpdated: now };
        writtenPaths.forEach(path => {
          const finalValue = readValueAtPath(patchedRecord, path);
          txnUpdate[path] = finalValue === undefined ? null : finalValue;
        });
        [...specialtyDecisions, ...automaticSpecialtyDecisions].forEach(decision => {
          transaction.set(
            docRef.collection('specialtyDecisions').doc(decision.decisionId),
            decision
          );
        });
        if (aiRequestRef) {
          transaction.update(aiRequestRef, {
            status: 'accepted',
            acceptedMutationId: mutationId,
            acceptedAt: new Date().toISOString(),
          });
        }
        derivedWrite?.apply(transaction, txnUpdate);
        transaction.update(docRef, txnUpdate);
      });
      txnMs = Date.now() - txnStartedAt;

      if (pendingHistoryData) {
        const historyStartedAt = Date.now();
        try {
          await docRef.collection('history').doc(new Date().toISOString()).set(pendingHistoryData);
        } catch (historyError) {
          console.error(
            'Daily record history snapshot failed after commit',
            sanitizeLogValue({ date, error: historyError })
          );
        }
        historyMs = Date.now() - historyStartedAt;
      }

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
        timings: buildTimings(),
        clinicalDerived: clinicalDerivedTelemetry,
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
      const handledError = asSpecialtyHttpsError(error);
      if (handledError instanceof functions.https.HttpsError) {
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
          errorCode: handledError.code,
          errorMessage: handledError.message,
          startedAt,
          timings: buildTimings(),
          clinicalDerived: clinicalDerivedTelemetry,
        });
        throw handledError;
      }

      console.error(
        'Error patching daily record with clinical authority',
        sanitizeLogValue({ email, date, error: handledError })
      );
      throw new functions.https.HttpsError(
        'internal',
        'Failed to patch daily record with clinical authority.'
      );
    }
  };

module.exports = { createPatchHandler };
