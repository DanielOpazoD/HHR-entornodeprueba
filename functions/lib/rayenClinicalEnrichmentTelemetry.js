const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { sanitizeLogValue } = require('./logging/redaction');

const operation = 'applyRayenClinicalEnrichmentBatch';

/**
 * One metadata-only telemetry row per clinical batch call; a failed write is logged, never thrown.
 *
 * @param {{
 *   firestore: any,
 *   requestSummary: any,
 *   startedAt: number,
 *   status: any,
 *   authorityStatus: any,
 *   resultParity: any,
 *   parityContractVersion: any,
 *   parityDiagnostics: any,
 *   revision: any,
 *   policyRevision: any,
 *   transactionAttempts: number,
 *   serverTimingsMs: any,
 *   transactionTimingsMs: any,
 *   error?: any,
 * }} params
 */
const recordTelemetry = async ({
  firestore,
  requestSummary,
  startedAt,
  status,
  authorityStatus,
  resultParity,
  parityContractVersion,
  parityDiagnostics,
  revision,
  policyRevision,
  transactionAttempts,
  serverTimingsMs,
  transactionTimingsMs,
  error,
}) => {
  try {
    await firestore
      .collection('hospitals')
      .doc(HOSPITAL_ID)
      .collection('functionsTelemetry')
      .add({
        service: 'rayenClinicalEnrichment',
        operation,
        hospitalId: HOSPITAL_ID,
        durationMs: Date.now() - startedAt,
        attempt: transactionAttempts,
        totalAttempts: transactionAttempts,
        status,
        errorCode: error?.code || null,
        timestamp: new Date().toISOString(),
        context: {
          ...requestSummary,
          serverTimingsMs,
          ...(transactionTimingsMs ? { transactionTimingsMs } : {}),
          authorityStatus,
          resultParity,
          parityContractVersion,
          ...parityDiagnostics,
          // Closed enum of a split-day rejection (clinicalDerivedStore); never the message.
          ...(error?.clinicalDerivedRejection
            ? { clinicalDerivedRejection: error.clinicalDerivedRejection }
            : {}),
          revision: Number.isFinite(revision) ? revision : null,
          policyRevision: Number.isFinite(policyRevision) ? policyRevision : null,
          transactionAttempts,
          transactionRetries: Math.max(0, transactionAttempts - 1),
        },
      });
  } catch (telemetryError) {
    console.warn(
      'Failed to record Rayen clinical enrichment telemetry',
      sanitizeLogValue({ date: requestSummary.date, error: telemetryError })
    );
  }
};

module.exports = { recordTelemetry };
