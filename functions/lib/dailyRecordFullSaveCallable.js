// saveDailyRecordWithClinicalAuthority: one transaction that writes a whole daily record.
const functions = require('firebase-functions/v1');
const {
  resolveCurrentRevision,
  assertExpectedRevision,
  assertExpectedVersion,
  assertVerifiableWriteBase,
} = require('./dailyRecordWriteVersionGuards');
const { applyTrustedClinicalCarryover } = require('./clinicalCarryoverSeed');
const { movementRestoreRecord } = require('./movementRestoreSources');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { addCalendarDays, calendarDayAtUtcNoon } = require('./hospitalCalendarDay');
const {
  readPriorDayForCarryover,
  settleClinicalDerivedFullSave,
} = require('./clinicalDerivedStore');
const { sanitizeLogValue } = require('./logging/redaction');
const { collectClinicalEpisodeCoverage } = require('./dailyRecordClinicalAuthorityPolicy');
const { protectSpecialtyDecisions } = require('./specialtyDecisionContract');
const { applyPendingSpecialtyRules, isCurrentRapaNuiDay } = require('./specialtyRules');
const {
  assertTrustedSpecialtyAssignments,
  assertUnusedSpecialtyDecisionIds,
} = require('./specialtyAuditAuthority');
const {
  isRayenClinicalWriteFenceActive,
  preserveRayenClinicalFields,
  shouldPreserveRayenClinicalFields,
} = require('./dailyRecordClinicalFieldPreservation');
const { normalizeShortString, parsePayload } = require('./dailyRecordWriteRequest');
const {
  assertAuthorizedDailyRecordWriter,
  assertClinicalAuthority,
  assertFullRecordWritePolicy,
  assertNoPatientErasures,
  assertNoPersistedEpisodeDowngrades,
  specialtyEpisodeEnabled,
} = require('./dailyRecordWritePolicy');
const {
  buildAuthorityRecordState,
  buildNextMeta,
  buildSlimHistorySnapshot,
  collectChangedPaths,
  hasAlreadyAppliedMutation,
  readValueAtPath,
} = require('./dailyRecordWriteRecordState');
const {
  asSpecialtyHttpsError,
  buildAuthorityResponse,
  idempotentAuthority,
  recordAuthorityTelemetry,
} = require('./dailyRecordAuthorityOutcome');
const { changedFieldPaths } = require('./dailyRecordFieldWrites');

const previousIsoDay = date =>
  Number.isFinite(calendarDayAtUtcNoon(date).getTime()) ? addCalendarDays(date, -1) : null;

const createFullSaveHandler =
  ({ firestore, Timestamp, resolveRoleForEmail }) =>
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
    const specialtyPolicyRef = hospitalRef.collection('specialtyPolicies').doc('active');
    const priorDate = previousIsoDay(date);
    const priorRef = priorDate ? hospitalRef.collection('dailyRecords').doc(priorDate) : null;
    let revision;
    let recordState;
    let responseAuthority = authority;
    let responseCoverage = coverage;
    let clinicalDerivedTelemetry;

    try {
      txnStartedAt = Date.now();
      await db.runTransaction(async transaction => {
        txnAttempts += 1;
        pendingHistoryData = null;
        clinicalDerivedTelemetry = undefined;
        const snapshot = await transaction.get(docRef);
        // Day bootstrap first writes an empty census, then imports Eloísa. The first
        // occupied write still needs yesterday's confirmed episode decisions.
        const hasActiveEpisodeIdentity = patient =>
          patient &&
          ['clinicalEpisodeId', 'rut', 'patientName', 'admissionDate'].some(field =>
            String(patient[field] ?? '').trim()
          );
        const isEmptyDay =
          !snapshot.exists ||
          !Object.values(snapshot.data()?.beds || {}).some(
            patient =>
              hasActiveEpisodeIdentity(patient) || hasActiveEpisodeIdentity(patient?.clinicalCrib)
          );
        const priorSnapshot = isEmptyDay && priorRef ? await transaction.get(priorRef) : null;
        if (
          hasAlreadyAppliedMutation({
            snapshot,
            syncContract,
            values: Object.fromEntries(
              collectChangedPaths(syncContract).map(path => [path, readValueAtPath(record, path)])
            ),
            uid: context.auth?.uid,
          })
        ) {
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

        if (!dryRun) {
          const changedPaths = collectChangedPaths(syncContract);
          assertVerifiableWriteBase({
            snapshot,
            syncContract,
            expectedLastUpdated,
            requireExactExpectedVersion:
              data?.expectedLastUpdated !== undefined &&
              (!changedPaths.length || changedPaths.includes('*')),
          });
        }
        assertExpectedVersion({ snapshot, expectedLastUpdated });
        assertExpectedRevision({ snapshot, syncContract });
        assertNoPatientErasures({ snapshot, record });
        assertNoPersistedEpisodeDowngrades({ snapshot, record });

        const policySnapshot = await transaction.get(policyRef);
        const specialtyPolicySnapshot = specialtyEpisodeEnabled()
          ? await transaction.get(specialtyPolicyRef)
          : null;
        const remoteData = snapshot.exists ? snapshot.data() || {} : {};
        await assertTrustedSpecialtyAssignments({
          transaction,
          hospitalRef,
          records: [remoteData, priorSnapshot?.exists ? priorSnapshot.data() : null],
        });
        let recordForPersistence = shouldPreserveRayenClinicalFields({
          policySnapshot,
          snapshot,
          origin,
          role,
        })
          ? preserveRayenClinicalFields({
              remoteRecord: remoteData,
              incomingRecord: record,
              // A queued device edit names its own paths; those keep what the nurse recorded.
              editedPaths: collectChangedPaths(syncContract),
            })
          : record;
        if (
          !snapshot.exists &&
          isCurrentRapaNuiDay(date) &&
          priorSnapshot?.exists &&
          shouldPreserveRayenClinicalFields({ policySnapshot, snapshot, origin, role })
        ) {
          recordForPersistence = applyTrustedClinicalCarryover({
            candidate: recordForPersistence,
            requested: record,
            // A split prior day is seen with its episode documents overlaid.
            priorRecord: await readPriorDayForCarryover({
              transaction,
              priorRef,
              priorData: priorSnapshot.data(),
            }),
          });
        }
        const derivedSave = settleClinicalDerivedFullSave({
          snapshotExists: snapshot.exists,
          remoteData,
          incoming: record,
          record: recordForPersistence,
          date,
          data,
          // With the Rayen fence the server drops or reseeds the client's clinical fields.
          keepsClientMovedFields: !shouldPreserveRayenClinicalFields({
            policySnapshot,
            snapshot,
            origin,
            role,
          }),
        });
        recordForPersistence = derivedSave.record;
        clinicalDerivedTelemetry = derivedSave.telemetry || undefined;
        await assertTrustedSpecialtyAssignments({
          transaction,
          hospitalRef,
          records: [movementRestoreRecord(remoteData, recordForPersistence)],
        });
        protectSpecialtyDecisions({
          remoteRecord: remoteData,
          priorRecord: priorSnapshot?.exists ? priorSnapshot.data() : null,
          candidate: recordForPersistence,
          actorUid: context.auth?.uid,
          mutationId: syncContract?.mutationId,
          now: new Date().toISOString(),
          guardScalarChanges: specialtyEpisodeEnabled(),
        });
        const automaticSpecialtyDecisions = specialtyEpisodeEnabled()
          ? applyPendingSpecialtyRules({
              catalogEnabled: isCurrentRapaNuiDay(date),
              eligibleBedIds:
                syncContract?.changedPaths?.length &&
                !syncContract.changedPaths.some(path => path === '*' || path === 'beds')
                  ? [
                      ...new Set(
                        syncContract.changedPaths
                          .filter(path => path.startsWith('beds.'))
                          .map(path => path.split('.')[1])
                      ),
                    ]
                  : undefined,
              remoteRecord: remoteData,
              candidate: recordForPersistence,
              policy: specialtyPolicySnapshot?.exists ? specialtyPolicySnapshot.data() : null,
              actorUid: context.auth?.uid,
              mutationId: syncContract?.mutationId,
              now: new Date().toISOString(),
            })
          : [];
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

        await assertUnusedSpecialtyDecisionIds({
          transaction,
          docRef,
          decisions: automaticSpecialtyDecisions,
        });

        const now = Timestamp.now();
        if (snapshot.exists) {
          // El snapshot de historial se escribe DESPUÉS del commit y adelgazado:
          // dentro de la transacción duplicaba el payload del registro completo
          // y alargaba cada escritura autoritativa sin proteger ningún invariante.
          pendingHistoryData = buildSlimHistorySnapshot(snapshot.data() || {}, now);
        }

        const nextMeta = buildNextMeta({
          remoteData,
          syncContract,
          now,
          record: recordForPersistence,
          fenced: isRayenClinicalWriteFenceActive(policySnapshot),
          // Only what this save changes: the other fields keep the edit that wrote them.
          writtenPaths: snapshot.exists
            ? changedFieldPaths(remoteData, recordForPersistence)
            : ['*'],
          writerUid: context.auth?.uid,
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
        automaticSpecialtyDecisions.forEach(decision => {
          transaction.set(
            docRef.collection('specialtyDecisions').doc(decision.decisionId),
            decision
          );
        });
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
        authority: responseAuthority,
        coverage: responseCoverage,
        syncContract,
        status: 'success',
        startedAt,
        timings: buildTimings(),
        clinicalDerived: clinicalDerivedTelemetry,
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
        'Error saving daily record with clinical authority',
        sanitizeLogValue({ email, date, error: handledError })
      );
      throw new functions.https.HttpsError(
        'internal',
        'Failed to save daily record with clinical authority.'
      );
    }
  };

module.exports = { createFullSaveHandler };
