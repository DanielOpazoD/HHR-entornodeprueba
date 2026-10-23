const functions = require('firebase-functions/v1');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const POLICY = 1;
const fail = () => {
  throw new functions.https.HttpsError('invalid-argument', 'Invalid CUDYR read view.');
};
const viewRef = (hospital, data, uid) => {
  if (data.hospitalId !== undefined || data.uid !== undefined || !uid) fail();
  for (const date of [data.from, data.to])
    if (
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date + 'T12:00:00Z')) ||
      new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date
    )
      fail();
  if (data.from > data.to || (Date.parse(data.to) - Date.parse(data.from)) / 86400000 > 31) fail();
  const key = createHash('sha256')
    .update(JSON.stringify([uid, data.from, data.to]))
    .digest('hex');
  return hospital.collection('cudyrReadViews').doc(key);
};
/** Expendable, owner-scoped presentation copy. Never used as clinical authority or official closure. */
const saveReadView = async ({ hospital, data, uid }) => {
  const ref = viewRef(hospital, data, uid);
  const report = data.report;
  if (
    report?.schemaVersion !== 1 ||
    report.from !== data.from ||
    report.to !== data.to ||
    report.readIncomplete !== false ||
    report.officialSnapshot ||
    report.readViewSnapshot ||
    !Number.isFinite(Date.parse(report.generatedAt)) ||
    !Number.isFinite(Date.parse(report.readStartedAt)) ||
    ![
      'rows',
      'coverage',
      'issues',
      'observations',
      'captures',
      'corrections',
      'dischargeAudit',
    ].every(k => Array.isArray(report[k])) ||
    report.rows.length > 5000 ||
    report.coverage.some(d => d.state === 'error')
  )
    fail();
  const json = JSON.stringify(report);
  if (Buffer.byteLength(json) > 8_000_000) fail();
  const packed = gzipSync(json);
  if (packed.length > 650_000) fail();
  return hospital.firestore.runTransaction(async tx => {
    const prior = await tx.get(ref);
    if (
      prior.exists &&
      prior.data().policyVersion === POLICY &&
      Date.parse(prior.data().readStartedAt) >= Date.parse(report.readStartedAt)
    )
      return { persisted: false };
    tx.set(ref, {
      policyVersion: POLICY,
      ownerUid: uid,
      from: data.from,
      to: data.to,
      generatedAt: report.generatedAt,
      readStartedAt: report.readStartedAt,
      savedAt: new Date().toISOString(),
      report: packed.toString('base64'),
    });
    return { persisted: true };
  });
};
const readReadView = async (hospital, data, uid) => {
  const doc = await viewRef(hospital, data, uid).get();
  const value = doc.data();
  if (!doc.exists || value.ownerUid !== uid || value.policyVersion !== POLICY)
    return { state: 'missing' };
  return { state: 'ready', savedAt: value.savedAt, report: value.report };
};
module.exports = { saveReadView, readReadView };
