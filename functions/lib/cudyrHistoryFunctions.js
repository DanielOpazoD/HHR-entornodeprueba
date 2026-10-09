const { saveOfficialReport, readOfficialReport } = require('./cudyrOfficialReportStore');
const {
  saveCudyrVerifiedContext,
  readCudyrVerifiedContext,
} = require('./cudyrVerifiedContextStore');
const { saveCudyrCensusSource, readCudyrCensusSources } = require('./cudyrCensusSourceStore');
const { saveCudyrExclusion, readCudyrExclusions } = require('./cudyrExclusionStore');
const functions = require('firebase-functions/v1');
const { isDeepStrictEqual } = require('node:util');
const { FieldPath } = require('firebase-admin/firestore');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { assertAuthorizedDailyRecordWriter } = require('./dailyRecordWriteAuthorityFunctions');
const { assertRayenClinicalBatchAuthority } = require('./rayenClinicalBatchAuthority');
const {
  parseArchiveRequest,
  parseHistoryQuery,
  evaluationKey,
  observationKey,
  owningCensusDate,
} = require('./cudyrHistoryContract');
const { episodeContext } = require('./cudyrHistoryContext');
const { captureKey } = require('./cudyrCaptureContract');
const { prepareCaptureManifest } = require('./cudyrCaptureManifest');
const { readEpisodeCaptures } = require('./cudyrPlacementContract');
const { saveDischargeCorrection } = require('./cudyrDischargeStore');
const { readDischargeCorrections, readDischargeAudit } = require('./cudyrDischargeRead');
const { saveCudyrSupplement, readCudyrSupplements } = require('./cudyrSupplementStore');
const { saveCudyrReview, readCudyrReviews } = require('./cudyrReviewStore');

const createCudyrHistoryFunctions = ({
  firestore,
  resolveRoleForEmail,
  hasCallableClinicalAccess,
}) => {
  const hospital = firestore.collection('hospitals').doc(HOSPITAL_ID);
  const history = hospital.collection('cudyrHistory');
  const captures = hospital.collection('cudyrCaptures');
  const runArchiveTransaction = async write => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await firestore.runTransaction(write);
      } catch (error) {
        // Concurrent creates of an absent content-addressed document can surface as gRPC 6.
        // Reread the entire authority and archive; never turn this error into an assumed ack.
        if (error.code !== 6 || attempt >= 2) throw error;
      }
    }
  };
  const archiveCudyrHistory = functions
    .region('southamerica-east1')
    .https.onCall(async (data, context) => {
      const { email, role } = await assertAuthorizedDailyRecordWriter({
        context,
        resolveRoleForEmail,
      });
      if (data?.kind === 'save-official-report')
        return saveOfficialReport({
          hospital,
          data,
          actor: {
            uid: context.auth.uid,
            email,
            role,
            name: String(context.auth.token.name || email).slice(0, 200),
          },
        });
      if (data?.kind === 'save-daily-exclusion') {
        if (!['admin', 'nurse_hospital'].includes(role))
          throw new functions.https.HttpsError(
            'permission-denied',
            'Review permission is required.'
          );
        return saveCudyrExclusion({
          hospital,
          data,
          runTransaction: runArchiveTransaction,
          actor: {
            uid: context.auth.uid,
            email,
            role,
            name: String(context.auth.token.name || email).slice(0, 200),
          },
        });
      }
      if (data?.kind === 'save-monthly-review' || data?.kind === 'save-verified-context') {
        if (!['admin', 'nurse_hospital'].includes(role))
          throw new functions.https.HttpsError(
            'permission-denied',
            'Review permission is required.'
          );
        return (data.kind === 'save-verified-context' ? saveCudyrVerifiedContext : saveCudyrReview)(
          {
            hospital,
            data,
            runTransaction: runArchiveTransaction,
            actor: {
              uid: context.auth.uid,
              email,
              role,
              name: String(context.auth.token.name || email).slice(0, 200),
            },
          }
        );
      }
      if (
        data?.kind === 'import-monthly-supplement' ||
        data?.kind === 'import-daily-census-source'
      ) {
        if (!['admin', 'nurse_hospital'].includes(role))
          throw new functions.https.HttpsError(
            'permission-denied',
            'Monthly import permission is required.'
          );
        return (
          data.kind === 'import-daily-census-source' ? saveCudyrCensusSource : saveCudyrSupplement
        )({
          hospital,
          data,
          runTransaction: runArchiveTransaction,
          actor: {
            uid: context.auth.uid,
            email,
            role,
            name: String(context.auth.token.name || email).slice(0, 200),
          },
        });
      }
      if (data?.kind === 'correct-discharge') {
        if (!['admin', 'nurse_hospital'].includes(role))
          throw new functions.https.HttpsError(
            'permission-denied',
            'Discharge editing permission is required.'
          );
        return saveDischargeCorrection({
          firestore,
          hospital,
          data,
          runTransaction: runArchiveTransaction,
          actor: {
            uid: context.auth.uid,
            email,
            role,
            name: String(context.auth.token.name || email).slice(0, 200),
          },
        });
      }
      const payload = parseArchiveRequest(data);
      const entries = payload.evaluations.map(evaluation => ({
        evaluation,
        id: observationKey(HOSPITAL_ID, evaluation),
        eventKey: evaluationKey(HOSPITAL_ID, evaluation),
      }));
      const receiptRef = payload.capture
        ? captures.doc(captureKey(HOSPITAL_ID, payload.authorityDate, payload.capture))
        : null;
      const results = await runArchiveTransaction(async transaction => {
        const recordRef = hospital.collection('dailyRecords').doc(payload.authorityDate);
        const recordSnapshot = await transaction.get(recordRef);
        const policySnapshot = await transaction.get(
          hospital.collection('settings').doc('rayenImportPolicy')
        );
        if (!recordSnapshot.exists)
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Synchronization census is missing.'
          );
        const record = recordSnapshot.data();
        assertRayenClinicalBatchAuthority({
          record,
          policySnapshot,
          payload: {
            date: payload.authorityDate,
            authorityDate: payload.authorityDate,
            runId: payload.runId,
            mode: 'enforced',
            legacyAuthorityInference: false,
          },
        });
        const contexts = entries.map(({ evaluation }) =>
          episodeContext(record, evaluation.clinicalEpisodeId)
        );
        const existing = await Promise.all(
          entries.map(entry => transaction.get(history.doc(entry.id)))
        );
        const receiptSnapshot = receiptRef ? await transaction.get(receiptRef) : null;
        const receiptContext = payload.capture
          ? episodeContext(record, payload.capture.clinicalEpisodeId)
          : null;
        const observationIds = entries.map(entry => entry.id);
        const writeManifest = await prepareCaptureManifest(
          transaction,
          hospital,
          HOSPITAL_ID,
          payload,
          observationIds
        );
        if (
          receiptSnapshot?.exists &&
          (!isDeepStrictEqual(receiptSnapshot.data().capture, payload.capture) ||
            JSON.stringify(receiptSnapshot.data().observationIds) !==
              JSON.stringify(observationIds))
        )
          throw new functions.https.HttpsError(
            'already-exists',
            'Capture identity has different content.'
          );
        const now = new Date().toISOString();
        if (receiptRef && !receiptSnapshot.exists) {
          const receipt = {
            schemaVersion: 1,
            id: receiptRef.id,
            censusDate: payload.authorityDate,
            capture: payload.capture,
            observationIds,
            captureContexts: receiptContext,
            receivedAt: now,
            receivedBy: email,
            verifiedRunId: payload.runId,
          };
          if (Buffer.byteLength(JSON.stringify(receipt), 'utf8') > 40_000)
            throw new functions.https.HttpsError(
              'resource-exhausted',
              'CUDYR receipt exceeds its size limit.'
            );
          transaction.create(receiptRef, receipt);
        }
        writeManifest();
        return entries.map(({ evaluation, id, eventKey }, index) => {
          const ref = history.doc(id);
          if (existing[index].exists) {
            // Identical source content is immutable. Updating verification cannot erase its author.
            if (now >= existing[index].data().lastVerifiedAt) {
              transaction.update(ref, {
                lastVerifiedAt: now,
                lastVerifiedRunId: payload.runId,
              });
            }
            return { id, eventKey, status: 'already-recorded' };
          }
          const observation = {
            schemaVersion: 1,
            id,
            eventKey,
            evaluation,
            censusDate: owningCensusDate(evaluation.recordedAt),
            attributionRule: 'hhr-night-v1',
            firstCapturedAt: now,
            lastVerifiedAt: now,
            firstCapturedBy: email,
            firstCaptureRunId: payload.runId,
            lastVerifiedRunId: payload.runId,
            captureCensusDate: payload.authorityDate,
            captureContexts: contexts[index],
          };
          // Bounds a 100-row callable page below its response-size limit, including context.
          if (Buffer.byteLength(JSON.stringify(observation), 'utf8') > 40_000) {
            throw new functions.https.HttpsError(
              'resource-exhausted',
              'CUDYR observation exceeds its size limit.'
            );
          }
          transaction.create(ref, observation);
          return { id, eventKey, status: 'recorded' };
        });
      });
      return {
        success: true,
        persisted: true,
        results,
        ...(receiptRef ? { captureReceiptId: receiptRef.id } : {}),
      };
    });

  const readCudyrHistory = functions
    .region('southamerica-east1')
    .https.onCall(async (data, context) => {
      if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in to read CUDYR history.');
      if (!(await hasCallableClinicalAccess(context))) {
        throw new functions.https.HttpsError('permission-denied', 'Clinical access is required.');
      }
      if (data?.kind === 'official-report') return readOfficialReport(hospital, data);
      if (data?.kind === 'daily-exclusions') return readCudyrExclusions(hospital, data);
      if (data?.kind === 'episode-captures') return readEpisodeCaptures(captures, data);
      if (data?.kind === 'discharge-corrections') return readDischargeCorrections(hospital, data);
      if (data?.kind === 'discharge-audit') return readDischargeAudit(hospital, data);
      if (data?.kind === 'verified-context') return readCudyrVerifiedContext(hospital, data);
      if (data?.kind === 'monthly-reviews') return readCudyrReviews(hospital, data);
      if (data?.kind === 'daily-census-sources') return readCudyrCensusSources(hospital, data);
      if (data?.kind === 'monthly-supplements') return readCudyrSupplements(hospital, data);
      const { from, to, limit, cursor, kind } = parseHistoryQuery(data);
      let query = (kind === 'captures' ? captures : history)
        .where('censusDate', '>=', from)
        .where('censusDate', '<=', to)
        .orderBy('censusDate')
        .orderBy(FieldPath.documentId());
      if (cursor) query = query.startAfter(cursor.date, cursor.id);
      const snapshot = await query.limit(limit + 1).get();
      const page = snapshot.docs.slice(0, limit).map(doc => doc.data());
      const last = page.at(-1);
      return {
        ...(kind === 'captures' ? { captures: page } : { observations: page }),
        nextCursor: snapshot.size > limit && last ? { date: last.censusDate, id: last.id } : null,
      };
    });
  return { archiveCudyrHistory, readCudyrHistory };
};

module.exports = { createCudyrHistoryFunctions };
