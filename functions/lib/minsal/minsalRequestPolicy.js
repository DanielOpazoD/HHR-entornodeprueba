const { HttpsError } = require('firebase-functions/v2/https');
const { assertSupportedHospitalId } = require('../runtime/hospitalPolicy');

const assertAuthenticatedClinicalRequest = async (context, hasCallableClinicalAccess) => {
  if (!context.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  const hasAccess = await hasCallableClinicalAccess(context);
  if (!hasAccess) {
    throw new HttpsError('permission-denied', 'You do not have access to this operation.');
  }
};

const getErrorMessage = error => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message);
  }
  return String(error);
};

const parseMinsalRangeRequest = data => {
  const hospitalId = typeof data?.hospitalId === 'string' ? data.hospitalId : '';
  const startDate = typeof data?.startDate === 'string' ? data.startDate : '';
  const endDate = typeof data?.endDate === 'string' ? data.endDate : '';

  if (!hospitalId || !startDate || !endDate) {
    throw new HttpsError(
      'invalid-argument',
      'Missing required parameters: hospitalId, startDate, endDate.'
    );
  }

  try {
    assertSupportedHospitalId(hospitalId);
  } catch (error) {
    throw new HttpsError('permission-denied', getErrorMessage(error));
  }

  return { hospitalId, startDate, endDate };
};

const loadMinsalRecords = async (firestore, hospitalId, startDate, endDate) => {
  const recordsRef = firestore.collection('hospitals').doc(hospitalId).collection('dailyRecords');
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
  getErrorMessage,
  loadMinsalRecords,
  parseMinsalRangeRequest,
};
