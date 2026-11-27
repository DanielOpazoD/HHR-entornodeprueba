const functions = require('firebase-functions/v1');
const { HttpsError } = require('firebase-functions/v2/https');
const { calculateMinsalStatistics } = require('./minsal/minsalStatsCalculator');
const {
  assertAuthenticatedClinicalRequest,
  getErrorMessage,
  loadMinsalRecords,
  parseMinsalRangeRequest,
} = require('./minsal/minsalRequestPolicy');
const {
  buildServerOwnedCalculationOptions,
  persistMinsalSpecialtyReclassification,
} = require('./minsal/minsalReclassifications');

const createMinsalFunctions = ({
  firestore,
  hospitalCapacity,
  hasCallableClinicalAccess,
  resolveRoleForEmail,
}) => ({
  calculateMinsalStats: functions.https.onCall(async (data, context) => {
    await assertAuthenticatedClinicalRequest(context, hasCallableClinicalAccess);
    const { hospitalId, startDate, endDate } = parseMinsalRangeRequest(data);

    try {
      const filteredRecords = await loadMinsalRecords(firestore, hospitalId, startDate, endDate);
      const options = await buildServerOwnedCalculationOptions({
        firestore,
        hospitalId,
        startDate,
        endDate,
        clientOptions: data && typeof data.options === 'object' ? data.options : {},
      });
      return calculateMinsalStatistics({
        records: filteredRecords,
        hospitalCapacity,
        startDate,
        endDate,
        options,
      });
    } catch (error) {
      console.error('Error calculating statistics:', error);
      throw new HttpsError('internal', `Error calculating statistics: ${getErrorMessage(error)}`);
    }
  }),

  setMinsalSpecialtyReclassification: functions.https.onCall(async (data, context) => {
    await assertAuthenticatedClinicalRequest(context, hasCallableClinicalAccess);
    try {
      return await persistMinsalSpecialtyReclassification({
        firestore,
        data,
        context,
        resolveRoleForEmail,
      });
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }
      console.error('Error saving statistical specialty reclassification:', error);
      throw new HttpsError(
        'internal',
        `Error saving statistical specialty reclassification: ${getErrorMessage(error)}`
      );
    }
  }),
});

module.exports = {
  createMinsalFunctions,
};
