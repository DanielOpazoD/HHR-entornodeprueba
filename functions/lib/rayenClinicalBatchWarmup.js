const { assertAuthorizedDailyRecordWriter } = require('./dailyRecordWritePolicy');

/**
 * The synchronization's warm-up call to `applyRayenClinicalEnrichmentBatch`: exactly
 * `{ warmup: true }`, nothing else, so a save payload can never be mistaken for it.
 */
const isClinicalBatchWarmup = data =>
  data !== null &&
  typeof data === 'object' &&
  !Array.isArray(data) &&
  Object.keys(data).length === 1 &&
  data.warmup === true;

/**
 * Runs only the callable's authorization. The caller's role read is this instance's first
 * Firestore RPC, which opens the connection (credentials, channel, protos) ~20–30 s before the
 * clinical save needs it. Production (W17-PERF4): the first authorization of an instance took
 * ~1.1 s and a later one ~0.1 s. No patient document is read; nothing is written or logged. An
 * unauthenticated caller is refused before any read.
 */
const answerClinicalBatchWarmup = async ({ context, resolveRoleForEmail }) => {
  await assertAuthorizedDailyRecordWriter({ context, resolveRoleForEmail });
  return { warmed: true };
};

module.exports = { answerClinicalBatchWarmup, isClinicalBatchWarmup };
