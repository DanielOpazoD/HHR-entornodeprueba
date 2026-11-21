// What an authority write reports: the callable response and its telemetry row.
const functions = require('firebase-functions/v1');
const { HOSPITAL_ID } = require('./runtime/runtimeConfig');
const { sanitizeLogValue } = require('./logging/redaction');
const { SpecialtyDecisionError } = require('./specialtyDecisionContract');
const { normalizeShortString } = require('./dailyRecordWriteRequest');
const { collectChangedPaths } = require('./dailyRecordWriteRecordState');

const asSpecialtyHttpsError = error => {
  if (error instanceof SpecialtyDecisionError) {
    return new functions.https.HttpsError(error.code, error.message, error.details);
  }
  return error;
};

const buildAuthorityResponse = ({
  date,
  mode,
  authority,
  coverage,
  revision,
  mutationId,
  recordState,
}) => {
  const response = {
    success: authority.status === 'ok' || authority.status === 'idempotent',
    date,
    mode,
    authorityStatus: authority.status,
    coverage,
    violations: authority.violations.map(violation => ({
      type: violation.type,
      path: violation.path,
      bedId: violation.bedId,
    })),
  };

  if (Number.isFinite(revision)) {
    response.revision = revision;
  }
  if (mutationId) {
    response.mutationId = mutationId;
  }
  if (recordState) {
    response.recordState = recordState;
  }

  return response;
};

const emptyCoverage = {
  activePatients: 0,
  canonicalEpisodeIds: 0,
  fallbackEpisodeKeys: 0,
  degenerateFallbackEpisodeKeys: 0,
};

const emptyAuthority = {
  status: 'blocked',
  violations: [],
};

const idempotentAuthority = {
  status: 'idempotent',
  violations: [],
};

const recordAuthorityTelemetry = async ({
  firestore,
  date,
  mode,
  origin,
  dryRun,
  authority,
  coverage,
  syncContract,
  status,
  operation = 'saveDailyRecordWithClinicalAuthority',
  errorCode = undefined,
  errorMessage = undefined,
  startedAt,
  timings = undefined,
  clinicalDerived = undefined,
}) => {
  try {
    const changedPaths = collectChangedPaths(syncContract);
    const safeAuthority = authority || emptyAuthority;
    const safeCoverage = coverage || emptyCoverage;
    await firestore
      .collection('hospitals')
      .doc(HOSPITAL_ID)
      .collection('functionsTelemetry')
      .add({
        service: 'dailyRecordWriteAuthority',
        operation,
        hospitalId: HOSPITAL_ID,
        durationMs: Date.now() - startedAt,
        // Fases del handler: separa autenticación, transacción (con reintentos)
        // e historial post-commit para poder atacar la tajada dominante.
        timings: timings || null,
        attempt: 1,
        totalAttempts: 1,
        status,
        // Firestore rechaza undefined: en éxito estos campos no existen y el
        // .add() fallaba silenciosamente — por eso nunca hubo telemetría de éxito.
        errorCode: errorCode ?? null,
        errorMessage: errorMessage ?? null,
        timestamp: new Date().toISOString(),
        context: {
          date,
          mode,
          origin,
          dryRun,
          authorityStatus: safeAuthority.status,
          violationCount: safeAuthority.violations.length,
          violationTypes: safeAuthority.violations.map(violation => violation.type).join(','),
          changedPathsCount: changedPaths.length,
          hasExpectedVersion: Boolean(syncContract?.expectedVersion),
          mutationId: normalizeShortString(syncContract?.mutationId) || null,
          activePatients: safeCoverage.activePatients,
          canonicalEpisodeIds: safeCoverage.canonicalEpisodeIds,
          fallbackEpisodeKeys: safeCoverage.fallbackEpisodeKeys,
          degenerateFallbackEpisodeKeys: safeCoverage.degenerateFallbackEpisodeKeys,
          // Split-day counters (clinicalDerivedStore); absent on legacy days.
          ...(clinicalDerived || {}),
        },
      });
  } catch (error) {
    console.warn(
      'Failed to record daily record authority telemetry',
      sanitizeLogValue({ date, error })
    );
  }
};

module.exports = {
  asSpecialtyHttpsError,
  buildAuthorityResponse,
  idempotentAuthority,
  recordAuthorityTelemetry,
};
