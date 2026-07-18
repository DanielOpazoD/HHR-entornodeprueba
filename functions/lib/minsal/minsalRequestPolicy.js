const functions = require('firebase-functions/v1');
const { assertSupportedHospitalId } = require('../runtime/hospitalPolicy');

const assertAuthenticatedClinicalRequest = async (context, hasCallableClinicalAccess) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.'
    );
  }

  const hasAccess = await hasCallableClinicalAccess(context);
  if (!hasAccess) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'You do not have access to this operation.'
    );
  }
};

const parseMinsalRangeRequest = data => {
  const hospitalId = typeof data?.hospitalId === 'string' ? data.hospitalId : '';
  const startDate = typeof data?.startDate === 'string' ? data.startDate : '';
  const endDate = typeof data?.endDate === 'string' ? data.endDate : '';

  if (!hospitalId || !startDate || !endDate) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Missing required parameters: hospitalId, startDate, endDate.'
    );
  }

  try {
    assertSupportedHospitalId(hospitalId);
  } catch (error) {
    throw new functions.https.HttpsError('permission-denied', error.message);
  }

  return { hospitalId, startDate, endDate };
};

const loadMinsalRecords = async (firestore, hospitalId, startDate, endDate) => {
  const recordsRef = firestore
    .collection('hospitals')
    .doc(hospitalId)
    .collection('dailyRecords');
  const snapshot = await recordsRef
    .where('date', '>=', startDate)
    .where('date', '<=', endDate)
    .get();

  const filteredRecords = [];
  snapshot.forEach(doc => {
    filteredRecords.push(doc.data());
  });
  return filteredRecords;
};

module.exports = {
  assertAuthenticatedClinicalRequest,
  loadMinsalRecords,
  parseMinsalRangeRequest,
};
