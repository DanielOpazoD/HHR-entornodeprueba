const functions = require('firebase-functions/v1');
const { createHash } = require('node:crypto');
const invalid = message => {
  throw new functions.https.HttpsError(
    'invalid-argument',
    message || 'Invalid CUDYR discharge correction.'
  );
};
const dateOnly = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01')
    invalid();
  const instant = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== value)
    invalid();
  return value;
};
const text = (value, max = 120) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) invalid();
  return value.trim();
};
const timeOnly = value => {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) invalid();
  return value;
};
const parseDischargeCorrection = data => {
  if (
    !data ||
    data.kind !== 'correct-discharge' ||
    data.schemaVersion !== 1 ||
    data.hospitalId !== undefined ||
    data.confirmed !== true ||
    !Number.isSafeInteger(data.expectedRevision) ||
    data.expectedRevision < 0 ||
    typeof data.operationId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(data.operationId)
  )
    invalid();
  let actualDischarge = null;
  if (data.actualDischarge !== null) {
    if (!data.actualDischarge || data.actualDischarge.timeZone !== 'Pacific/Easter') invalid();
    actualDischarge = {
      date: dateOnly(data.actualDischarge.date),
      timeZone: 'Pacific/Easter',
      ...(data.actualDischarge.time !== undefined
        ? { time: timeOnly(data.actualDischarge.time) }
        : {}),
    };
  }
  return {
    schemaVersion: 1,
    operationId: data.operationId,
    authorityDate: dateOnly(data.authorityDate),
    clinicalEpisodeId: text(data.clinicalEpisodeId),
    expectedRevision: data.expectedRevision,
    actualDischarge,
    reason: text(data.reason, 500),
  };
};
const dischargeKey = episodeId => createHash('sha256').update(episodeId).digest('hex');
const dischargeAuditKey = (episodeId, operationId) =>
  createHash('sha256')
    .update(JSON.stringify([episodeId, operationId]))
    .digest('hex');
module.exports = {
  parseDischargeCorrection,
  dischargeKey,
  dischargeAuditKey,
  dateOnly,
  timeOnly,
  text,
  invalid,
};
