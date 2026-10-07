const functions = require('firebase-functions/v1');
const { createHash } = require('node:crypto');

const invalid = () => {
  throw new functions.https.HttpsError('invalid-argument', 'Invalid CUDYR capture receipt.');
};

/** A receipt proves one bounded source observation, never historical monthly completeness. */
const parseCapture = (value, evaluations) => {
  if (value === undefined) return undefined;
  if (
    !value ||
    !/^[a-zA-Z0-9_-]{16,100}$/.test(value.id) ||
    typeof value.clinicalEpisodeId !== 'string' ||
    !value.clinicalEpisodeId.trim() ||
    value.clinicalEpisodeId.length > 120 ||
    typeof value.sourceRunId !== 'string' ||
    !value.sourceRunId.trim() ||
    value.sourceRunId.length > 120 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.observedAt) ||
    !Number.isFinite(Date.parse(value.observedAt)) ||
    new Date(value.observedAt).toISOString() !== value.observedAt ||
    !['observed', 'not_observed', 'unavailable', 'legacy_extension'].includes(value.status) ||
    !['complete', 'partial', 'unknown'].includes(value.metadataStatus) ||
    !Number.isInteger(value.part) ||
    !Number.isInteger(value.totalParts) ||
    !Number.isInteger(value.totalEvaluations) ||
    value.totalEvaluations < 0 ||
    value.totalEvaluations > 256 ||
    value.totalParts !== Math.max(1, Math.ceil(value.totalEvaluations / 32)) ||
    value.part < 0 ||
    value.part >= value.totalParts ||
    evaluations.length !== Math.min(32, Math.max(0, value.totalEvaluations - value.part * 32)) ||
    evaluations.some(item => item.clinicalEpisodeId !== value.clinicalEpisodeId) ||
    (['unavailable', 'not_observed'].includes(value.status) && evaluations.length > 0)
  )
    invalid();
  if (
    value.metadataStatus === 'complete' &&
    evaluations.some(
      item =>
        !item.author ||
        !item.authorId ||
        !item.authorRoleId ||
        !item.sourceVersion ||
        item.items?.length !== 14 ||
        new Set(item.items.map(field => field.fieldId)).size !== 14
    )
  )
    invalid();
  return {
    id: value.id,
    clinicalEpisodeId: value.clinicalEpisodeId,
    sourceRunId: value.sourceRunId,
    observedAt: value.observedAt,
    status: value.status,
    metadataStatus: value.metadataStatus,
    part: value.part,
    totalParts: value.totalParts,
    totalEvaluations: value.totalEvaluations,
  };
};

const captureKey = (hospitalId, authorityDate, capture) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        hospitalId,
        authorityDate,
        capture.id,
        capture.clinicalEpisodeId,
        capture.part,
      ])
    )
    .digest('hex');

module.exports = { parseCapture, captureKey };
