const functions = require('firebase-functions/v1');
const { HOSPITAL_CAPACITY, HOSPITAL_ID } = require('./runtime/runtimeConfig');
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
// One physical bed and, when applicable, its nested clinical crib.
const MAX_ADMIN_CUDYR_ADJUSTMENTS = HOSPITAL_CAPACITY * 2;

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

const parseAdjustment = data => {
  const rawCategory = data?.category;
  const category =
    rawCategory === null ? null : assertString(rawCategory, 'category', 2).toUpperCase();
  if (category !== null && !VALID_CUDYR_CATEGORIES.has(category)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'category must be one of the supported CUDYR results or null for removal.'
    );
  }

  const expectedCurrentCategory =
    data?.expectedCurrentCategory === undefined
      ? undefined
      : data.expectedCurrentCategory === null
        ? null
        : assertString(data.expectedCurrentCategory, 'expectedCurrentCategory', 2).toUpperCase();
  if (
    expectedCurrentCategory !== undefined &&
    expectedCurrentCategory !== null &&
    !VALID_CUDYR_CATEGORIES.has(expectedCurrentCategory)
  ) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'expectedCurrentCategory must be a supported CUDYR result, null or omitted.'
    );
  }
  const parseOptionalSnapshotString = (value, fieldName, maxLength) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return assertString(value, fieldName, maxLength);
  };

  return {
    bedId: assertString(data?.bedId, 'bedId', 80),
    clinicalCrib: data?.clinicalCrib === true,
    clinicalEpisodeId: assertString(data?.clinicalEpisodeId, 'clinicalEpisodeId', 160),
    category,
    ...(expectedCurrentCategory !== undefined ? { expectedCurrentCategory } : {}),
    ...(data?.expectedRecordedAt !== undefined
      ? {
          expectedRecordedAt: parseOptionalSnapshotString(
            data.expectedRecordedAt,
            'expectedRecordedAt',
            80
          ),
        }
      : {}),
    ...(data?.expectedRecordedDate !== undefined
      ? {
          expectedRecordedDate: parseOptionalSnapshotString(
            data.expectedRecordedDate,
            'expectedRecordedDate',
            10
          ),
        }
      : {}),
    ...(data?.expectedSource !== undefined
      ? {
          expectedSource: parseOptionalSnapshotString(data.expectedSource, 'expectedSource', 160),
        }
      : {}),
  };
};

const parsePayload = data => {
  const date = assertString(data?.date, 'date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new functions.https.HttpsError('invalid-argument', 'date must use YYYY-MM-DD.');
  }

  const rawAdjustments = Array.isArray(data?.adjustments) ? data.adjustments : [data];
  if (rawAdjustments.length === 0 || rawAdjustments.length > MAX_ADMIN_CUDYR_ADJUSTMENTS) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `adjustments must contain between 1 and ${MAX_ADMIN_CUDYR_ADJUSTMENTS} entries.`
    );
  }
  const adjustments = rawAdjustments.map(parseAdjustment);
  const targetKeys = adjustments.map(
    adjustment => `${adjustment.bedId}:${adjustment.clinicalCrib ? 'crib' : 'bed'}`
  );
  if (new Set(targetKeys).size !== targetKeys.length) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'adjustments cannot contain the same patient target more than once.'
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
    adjustments,
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
    let revision = null;
    let changes = [];

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

        const now = Timestamp.now();
        revision = resolveCurrentRevision(remoteRecord);
        const nextRecord = clone(remoteRecord);
        nextRecord.beds = clone(remoteRecord.beds || {});
        const resolvedAdjustments = payload.adjustments.map(adjustment => {
          const bed = remoteRecord.beds?.[adjustment.bedId];
          const patient = adjustment.clinicalCrib ? bed?.clinicalCrib : bed;
          if (!patient || typeof patient !== 'object') {
            throw new functions.https.HttpsError(
              'failed-precondition',
              'A selected patient is no longer present in the expected bed.'
            );
          }
          if (patient.clinicalEpisodeId !== adjustment.clinicalEpisodeId) {
            throw new functions.https.HttpsError(
              'aborted',
              'A clinical episode changed before the administrative CUDYR adjustment.'
            );
          }
          const { nextPatient, previousCategory } = updatePatientCudyr({
            patient,
            category: adjustment.category,
            date: payload.date,
            email,
          });
          const currentImportedCudyr = patient.evaluationScores?.cudyr;
          if (
            (adjustment.expectedCurrentCategory !== undefined &&
              previousCategory !== adjustment.expectedCurrentCategory) ||
            (adjustment.expectedRecordedAt !== undefined &&
              (currentImportedCudyr?.recordedAt ?? null) !== adjustment.expectedRecordedAt) ||
            (adjustment.expectedRecordedDate !== undefined &&
              (currentImportedCudyr?.recordedDate ?? null) !== adjustment.expectedRecordedDate) ||
            (adjustment.expectedSource !== undefined &&
              (currentImportedCudyr?.source ?? null) !== adjustment.expectedSource)
          ) {
            throw new functions.https.HttpsError(
              'aborted',
              'A selected CUDYR result changed before the administrative adjustment.'
            );
          }
          return {
            ...adjustment,
            previousCategory,
            nextPatient,
            changed: previousCategory !== adjustment.category,
          };
        });

        changes = resolvedAdjustments.map(({ nextPatient: _nextPatient, ...change }) => change);
        const changedAdjustments = resolvedAdjustments.filter(adjustment => adjustment.changed);
        if (changedAdjustments.length === 0) return;

        changedAdjustments.forEach(adjustment => {
          const currentBed = nextRecord.beds[adjustment.bedId];
          if (adjustment.clinicalCrib) {
            currentBed.clinicalCrib = adjustment.nextPatient;
          } else {
            nextRecord.beds[adjustment.bedId] = {
              ...adjustment.nextPatient,
              clinicalCrib: currentBed?.clinicalCrib,
            };
            if (!currentBed?.clinicalCrib) {
              delete nextRecord.beds[adjustment.bedId].clinicalCrib;
            }
          }
        });
        revision += 1;
        nextRecord.meta = {
          ...(remoteRecord.meta && typeof remoteRecord.meta === 'object'
            ? clone(remoteRecord.meta)
            : {}),
          revision,
          lastChangedPaths: changedAdjustments.map(
            adjustment =>
              `beds.${adjustment.bedId}${adjustment.clinicalCrib ? '.clinicalCrib' : ''}.evaluationScores.cudyr`
          ),
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
            changedAdjustments.length === 1
              ? changedAdjustments[0].category === null
                ? 'Resultado CUDYR eliminado por administrador'
                : 'Resultado CUDYR ajustado por administrador'
              : `${changedAdjustments.length} resultados CUDYR ajustados por administrador`,
          details: {
            event: 'admin_cudyr_results_adjusted',
            changedCount: changedAdjustments.length,
            changes: changedAdjustments.map(
              ({ nextPatient: _nextPatient, changed: _changed, ...change }) => change
            ),
          },
          recordDate: payload.date,
        });
      });

      const firstChange = changes[0] || null;
      return {
        success: true,
        date: payload.date,
        ...(firstChange && payload.adjustments.length === 1
          ? {
              bedId: firstChange.bedId,
              clinicalCrib: firstChange.clinicalCrib,
              previousCategory: firstChange.previousCategory,
              category: firstChange.category,
            }
          : {}),
        revision,
        changed: changes.some(change => change.changed),
        changedCount: changes.filter(change => change.changed).length,
        changes,
      };
    } catch (error) {
      if (error instanceof functions.https.HttpsError) throw error;
      console.error(
        'Error adjusting CUDYR result as administrator',
        sanitizeLogValue({
          email,
          date: payload.date,
          targetCount: payload.adjustments.length,
          error,
        })
      );
      throw new functions.https.HttpsError('internal', 'Failed to adjust the CUDYR result.');
    }
  }),
});

module.exports = {
  ADMIN_CUDYR_SOURCE,
  MAX_ADMIN_CUDYR_ADJUSTMENTS,
  VALID_CUDYR_CATEGORIES,
  createAdminCudyrResultFunctions,
  parsePayload,
  updatePatientCudyr,
};
