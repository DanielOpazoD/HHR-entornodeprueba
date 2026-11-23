const { digestValue } = require('./rayenClinicalEnrichmentPolicy');

// v3: parity compares the combined view (episode documents over the day, phase 1a D13). Only
// split days report it, so unmarked days keep their v2 evidence exactly as before.
const PARITY_CONTRACT_VERSION = 3;
const UNSPLIT_PARITY_CONTRACT_VERSION = 2;

/** @type {Readonly<{ mismatchTargetCount: number, mismatchFieldCount: number, mismatchDeviceFieldCount: number, mismatchScoreFieldCount: number, mismatchVitalFieldCount: number, mismatchCheckpointFieldCount: number }>} */
const EMPTY_PARITY_DIAGNOSTICS = Object.freeze({
  mismatchTargetCount: 0,
  mismatchFieldCount: 0,
  mismatchDeviceFieldCount: 0,
  mismatchScoreFieldCount: 0,
  mismatchVitalFieldCount: 0,
  mismatchCheckpointFieldCount: 0,
});

const countFields = patches =>
  patches.reduce((total, target) => total + Object.keys(target.fields).length, 0);

const correlationId = value =>
  typeof value === 'string' && value.length > 0 ? digestValue(value).slice(0, 16) : null;

const resolveTargetScope = ({ date, authorityDate }) =>
  typeof date === 'string' && typeof authorityDate === 'string' && date !== authorityDate
    ? 'historical'
    : 'current';

const buildPersistenceFailureDetails = (requestSummary, transactionAttempts) => ({
  targetScope: requestSummary.targetScope,
  transactionAttempts,
  transactionRetries: Math.max(0, transactionAttempts - 1),
});

const summarizeRequest = data => {
  const patches = Array.isArray(data?.patches) ? data.patches : [];
  const checkpoints = Array.isArray(data?.checkpoints) ? data.checkpoints : [];
  const targetKeys = new Set(
    [...patches, ...checkpoints].map(
      target =>
        `${String(target?.bedId || '')}|${target?.clinicalCrib === true ? 'crib' : 'patient'}`
    )
  );
  const clinicalKeys = new Set(
    patches.map(
      target =>
        `${String(target?.bedId || '')}|${target?.clinicalCrib === true ? 'crib' : 'patient'}`
    )
  );
  const date =
    typeof data?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : null;
  const mode = data?.mode === 'enforced' ? data.mode : 'invalid';
  return {
    date,
    mode,
    dryRun: false,
    targetCount: targetKeys.size,
    clinicalTargetCount: clinicalKeys.size,
    checkpointTargetCount: checkpoints.length,
    checkpointOnlyTargetCount: [...targetKeys].filter(key => !clinicalKeys.has(key)).length,
    fieldCount:
      patches.reduce(
        (total, target) =>
          total +
          (target?.fields && typeof target.fields === 'object' && !Array.isArray(target.fields)
            ? Object.keys(target.fields).length
            : 0),
        0
      ) + checkpoints.length,
    clinicalCribCount: patches.filter(target => target?.clinicalCrib === true).length,
    hasExpectedVersion: typeof data?.expectedLastUpdated === 'string',
    hasBaseRevision:
      data?.baseRevision !== undefined && data?.baseRevision !== null && data?.baseRevision !== '',
    fieldContractVersion: data?.fieldContractVersion === 2 ? 2 : 1,
    versionGuardEnforced: mode === 'enforced',
    targetScope: resolveTargetScope(data || {}),
    runCorrelationId: correlationId(data?.runId),
    mutationCorrelationId: correlationId(data?.mutationId),
  };
};

const summarizePayload = payload => ({
  date: payload.date,
  mode: payload.mode,
  dryRun: false,
  targetCount: payload.targets.length,
  clinicalTargetCount: payload.patches.length,
  checkpointTargetCount: payload.checkpoints.length,
  checkpointOnlyTargetCount: payload.checkpoints.filter(
    target =>
      !payload.patches.some(
        patch => patch.bedId === target.bedId && patch.clinicalCrib === target.clinicalCrib
      )
  ).length,
  fieldCount: countFields(payload.targets),
  clinicalCribCount: payload.targets.filter(target => target.clinicalCrib).length,
  hasExpectedVersion: Boolean(payload.expectedLastUpdated),
  hasBaseRevision: payload.baseRevision !== undefined,
  fieldContractVersion: payload.fieldContractVersion,
  versionGuardEnforced: true,
  targetScope: resolveTargetScope(payload),
  runCorrelationId: correlationId(payload.runId),
  mutationCorrelationId: correlationId(payload.mutationId),
});

const createEnrichmentTimingTracker = monotonicNow => {
  const handlerStartedAt = monotonicNow();
  const elapsed = start => Math.max(0, Math.round(monotonicNow() - start));
  const serverTimingsMs = {};
  let transactionTimingsMs;
  let phaseStartedAt = handlerStartedAt;
  let phase = 'authorizationMs';

  return {
    serverTimingsMs,
    getTransactionTimings: () => transactionTimingsMs,
    beginPhase(nextPhase) {
      phase = nextPhase;
      phaseStartedAt = monotonicNow();
    },
    finishPhase(name) {
      serverTimingsMs[name] = elapsed(phaseStartedAt);
      phase = null;
    },
    finishActivePhase() {
      if (phase) serverTimingsMs[phase] = elapsed(phaseStartedAt);
    },
    finishHandler() {
      serverTimingsMs.handlerMs = elapsed(handlerStartedAt);
    },
    startTransaction() {
      phase = 'transactionMs';
      phaseStartedAt = monotonicNow();
      transactionTimingsMs = { callbackMs: 0, documentReadMs: 0, specialtyAuditMs: 0 };
    },
    recordCallbackDuration(callbackStartedAt) {
      transactionTimingsMs.callbackMs += Math.max(0, monotonicNow() - callbackStartedAt);
    },
    async measureTransactionOperation(key, operation) {
      const start = monotonicNow();
      try {
        return await operation();
      } finally {
        transactionTimingsMs[key] += Math.max(0, monotonicNow() - start);
      }
    },
    finalizeTransactionTimings() {
      if (!transactionTimingsMs) return;
      const { callbackMs, documentReadMs, specialtyAuditMs } = transactionTimingsMs;
      transactionTimingsMs = {
        callbackMs: Math.round(callbackMs),
        documentReadMs: Math.round(documentReadMs),
        specialtyAuditMs: Math.round(specialtyAuditMs),
        otherCallbackMs: Math.max(0, Math.round(callbackMs - documentReadMs - specialtyAuditMs)),
        // Includes SDK commit, retries/backoff and scheduling; not a pure commit measurement.
        outsideCallbackMs: Math.max(0, Math.round(serverTimingsMs.transactionMs - callbackMs)),
      };
    },
  };
};

module.exports = {
  PARITY_CONTRACT_VERSION,
  UNSPLIT_PARITY_CONTRACT_VERSION,
  EMPTY_PARITY_DIAGNOSTICS,
  countFields,
  resolveTargetScope,
  buildPersistenceFailureDetails,
  summarizeRequest,
  summarizePayload,
  createEnrichmentTimingTracker,
};
