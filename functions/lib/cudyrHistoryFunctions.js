const functions = require('firebase-functions/v1');
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

const createCudyrHistoryFunctions = ({
  firestore,
  resolveRoleForEmail,
  hasCallableClinicalAccess,
}) => {
  const hospital = firestore.collection('hospitals').doc(HOSPITAL_ID);
  const history = hospital.collection('cudyrHistory');
  const archiveCudyrHistory = functions
    .region('southamerica-east1')
    .https.onCall(async (data, context) => {
      const { email } = await assertAuthorizedDailyRecordWriter({ context, resolveRoleForEmail });
      const payload = parseArchiveRequest(data);
      const entries = payload.evaluations.map(evaluation => ({
        evaluation,
        id: observationKey(HOSPITAL_ID, evaluation),
        eventKey: evaluationKey(HOSPITAL_ID, evaluation),
      }));
      const results = await firestore.runTransaction(async transaction => {
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
        const now = new Date().toISOString();
        return entries.map(({ evaluation, id, eventKey }, index) => {
          const ref = history.doc(id);
          if (existing[index].exists) {
            // Identical source content is immutable. Updating verification cannot erase its author.
            if (now >= existing[index].data().lastVerifiedAt) {
              transaction.update(ref, { lastVerifiedAt: now, lastVerifiedRunId: payload.runId });
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
      return { success: true, persisted: true, results };
    });

  const readCudyrHistory = functions
    .region('southamerica-east1')
    .https.onCall(async (data, context) => {
      if (!context.auth)
        throw new functions.https.HttpsError('unauthenticated', 'Sign in to read CUDYR history.');
      if (!(await hasCallableClinicalAccess(context))) {
        throw new functions.https.HttpsError('permission-denied', 'Clinical access is required.');
      }
      const { from, to, limit, cursor } = parseHistoryQuery(data);
      let query = history
        .where('censusDate', '>=', from)
        .where('censusDate', '<=', to)
        .orderBy('censusDate')
        .orderBy(FieldPath.documentId());
      if (cursor) query = query.startAfter(cursor.date, cursor.id);
      const snapshot = await query.limit(limit + 1).get();
      const page = snapshot.docs.slice(0, limit).map(doc => doc.data());
      const last = page.at(-1);
      return {
        observations: page,
        nextCursor: snapshot.size > limit && last ? { date: last.censusDate, id: last.id } : null,
      };
    });
  return { archiveCudyrHistory, readCudyrHistory };
};

module.exports = { createCudyrHistoryFunctions };
