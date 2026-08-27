const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { requireAuthenticatedEmail } = require('./auth/authPolicies');
const { sanitizeLogValue } = require('./logging/redaction');

const VALID_CUDYR_CATEGORIES = new Set([
  'A1',
  'A2',
  'A3',
  'B1',
  'B2',
  'B3',
  'C1',
  'C2',
  'C3',
  'D1',
  'D2',
  'D3',
]);
const ADMIN_CUDYR_SOURCE = 'HHR · ajuste administrativo';

const assertString = (value, fieldName, maxLength = 120) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Missing required field: ${fieldName}`
    );
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `${fieldName} exceeds the maximum supported length.`
    );
  }
  return normalized;
};

const toMillis = value => {
  if (!value) return null;
  if (typeof value.toDate === 'function') {
    const millis = value.toDate().getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? millis : null;
};

const parsePayload = data => {
  const date = assertString(data?.date, 'date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new functions.https.HttpsError('invalid-argument', 'date must use YYYY-MM-DD.');
  }

  const rawCategory = data?.category;
  const category =
    rawCategory === null ? null : assertString(rawCategory, 'category', 2).toUpperCase();
  if (category !== null && !VALID_CUDYR_CATEGORIES.has(category)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'category must be one of the supported CUDYR results or null for removal.'
    );
  }

  const expectedLastUpdated = assertString(data?.expectedLastUpdated, 'expectedLastUpdated', 80);
  if (!Number.isFinite(Date.parse(expectedLastUpdated))) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'expectedLastUpdated must be a valid date-time value.'
    );
  }

  return {
    date,
    bedId: assertString(data?.bedId, 'bedId', 80),
    clinicalCrib: data?.clinicalCrib === true,
    clinicalEpisodeId: assertString(data?.clinicalEpisodeId, 'clinicalEpisodeId', 160),
    category,
    expectedLastUpdated,
  };
};

const resolveCurrentRevision = record => {
  const revision = Number(record?.meta?.revision);
  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
};

const clone = value => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    if (value instanceof Date || typeof value.toDate === 'function') return value;
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  }
  return value;
};

const updatePatientCudyr = ({ patient, category, date, email }) => {
  const nextPatient = clone(patient);
  const evaluationScores = clone(nextPatient.evaluationScores || {});
  const previousCategory =
    typeof evaluationScores.cudyr?.category === 'string'
      ? evaluationScores.cudyr.category.trim().toUpperCase()
      : null;

  if (category === null) {
    delete evaluationScores.cudyr;
  } else {
    evaluationScores.cudyr = {
      category,
      recordedDate: date,
      author: email,
      authorRole: 'Administrador',
      source: ADMIN_CUDYR_SOURCE,
    };
  }

  if (Object.keys(evaluationScores).length === 0) {
    delete nextPatient.evaluationScores;
  } else {
    nextPatient.evaluationScores = evaluationScores;
  }

  return { nextPatient, previousCategory };
};

const createAdminCudyrResultFunctions = ({ firestore, Timestamp, resolveRoleForEmail }) => ({
  setAdminCudyrResult: functions.https.onCall(async (data, context) => {
    const email = requireAuthenticatedEmail(context);
    const role = await resolveRoleForEmail(email);
    if (role !== 'admin') {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Only an administrator can adjust an imported CUDYR result.'
      );
    }

    const payload = parsePayload(data);
    const hospitalRef = firestore.collection('hospitals').doc(HOSPITAL_ID);
    const recordRef = hospitalRef.collection('dailyRecords').doc(payload.date);
    const historyRef = recordRef.collection('history').doc();
    const auditRef = hospitalRef.collection('auditLogs').doc();
    let previousCategory = null;
    let revision = null;
    let changed = false;

    try {
      await firestore.runTransaction(async transaction => {
        const snapshot = await transaction.get(recordRef);
        if (!snapshot.exists) {
          throw new functions.https.HttpsError('not-found', 'Daily record not found.');
        }

        const remoteRecord = snapshot.data() || {};
        const remoteVersion = toMillis(remoteRecord.lastUpdated);
        if (remoteVersion === null) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'Daily record has no verifiable version for an administrative CUDYR adjustment.'
          );
        }
        if (remoteVersion !== toMillis(payload.expectedLastUpdated)) {
          throw new functions.https.HttpsError(
            'aborted',
            'Daily record changed before the administrative CUDYR adjustment.'
          );
        }

        const bed = remoteRecord.beds?.[payload.bedId];
        const patient = payload.clinicalCrib ? bed?.clinicalCrib : bed;
        if (!patient || typeof patient !== 'object') {
          throw new functions.https.HttpsError(
            'failed-precondition',
            'The selected patient is no longer present in this bed.'
          );
        }
        if (patient.clinicalEpisodeId !== payload.clinicalEpisodeId) {
          throw new functions.https.HttpsError(
            'aborted',
            'The clinical episode changed before the administrative CUDYR adjustment.'
          );
        }

        const now = Timestamp.now();
        const { nextPatient, previousCategory: resolvedPreviousCategory } = updatePatientCudyr({
          patient,
          category: payload.category,
          date: payload.date,
          email,
        });
        previousCategory = resolvedPreviousCategory;
        revision = resolveCurrentRevision(remoteRecord);
        if (previousCategory === payload.category) return;

        changed = true;
        const nextRecord = clone(remoteRecord);
        nextRecord.beds = clone(remoteRecord.beds || {});
        nextRecord.beds[payload.bedId] = clone(bed);
        if (payload.clinicalCrib) {
          nextRecord.beds[payload.bedId].clinicalCrib = nextPatient;
        } else {
          nextRecord.beds[payload.bedId] = nextPatient;
        }
        revision += 1;
        nextRecord.meta = {
          ...(remoteRecord.meta && typeof remoteRecord.meta === 'object'
            ? clone(remoteRecord.meta)
            : {}),
          revision,
          lastChangedPaths: [
            `beds.${payload.bedId}${payload.clinicalCrib ? '.clinicalCrib' : ''}.evaluationScores.cudyr`,
          ],
          updatedAt: now,
        };
        nextRecord.lastUpdated = now;

        transaction.set(historyRef, {
          ...remoteRecord,
          snapshotTimestamp: now,
          snapshotReason: 'admin_cudyr_adjustment',
          snapshotActor: email,
        });
        transaction.set(recordRef, nextRecord);
        transaction.set(auditRef, {
          id: auditRef.id,
          timestamp: now,
          userId: email,
          userDisplayName: email,
          userUid: context.auth?.uid || null,
          action: 'CUDYR_MODIFIED',
          entityType: 'dailyRecord',
          entityId: payload.date,
          summary:
            payload.category === null
              ? 'Resultado CUDYR eliminado por administrador'
              : 'Resultado CUDYR ajustado por administrador',
          details: {
            event: 'admin_cudyr_result_adjusted',
            bedId: payload.bedId,
            clinicalCrib: payload.clinicalCrib,
            clinicalEpisodeId: payload.clinicalEpisodeId,
            previousCategory,
            category: payload.category,
          },
          recordDate: payload.date,
        });
      });

      return {
        success: true,
        date: payload.date,
        bedId: payload.bedId,
        clinicalCrib: payload.clinicalCrib,
        previousCategory,
        category: payload.category,
        revision,
        changed,
      };
    } catch (error) {
      if (error instanceof functions.https.HttpsError) throw error;
      console.error(
        'Error adjusting CUDYR result as administrator',
        sanitizeLogValue({ email, date: payload.date, bedId: payload.bedId, error })
      );
      throw new functions.https.HttpsError('internal', 'Failed to adjust the CUDYR result.');
    }
  }),
});

module.exports = {
  ADMIN_CUDYR_SOURCE,
  VALID_CUDYR_CATEGORIES,
  createAdminCudyrResultFunctions,
  parsePayload,
  updatePatientCudyr,
};
