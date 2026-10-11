const { isDeepStrictEqual } = require('node:util');
const {
  readCudyrWorkbookMatrix,
  parseCudyrCensusSource,
} = require('./generated/cudyrSourceParser.cjs');
const { createHash } = require('node:crypto');
const functions = require('firebase-functions/v1');
const invalid = () => {
  throw new functions.https.HttpsError('invalid-argument', 'Invalid historical census source.');
};
const validDate = value =>
  typeof value === 'string' &&
  /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T12:00:00Z')) &&
  new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
const parseCensusSource = data => {
  if (
    data?.hospitalId !== undefined ||
    data?.confirmed !== true ||
    !validDate(data?.source?.date) ||
    !Array.isArray(data.source.patients) ||
    data.source.patients.length > 500 ||
    typeof data.observedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(data.observedAt) ||
    !Number.isFinite(Date.parse(data.observedAt)) ||
    Date.parse(data.observedAt) > Date.now() + 60000 ||
    typeof data.base64 !== 'string' ||
    data.base64.length > 349528 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data.base64)
  )
    invalid();
  const bytes = Buffer.from(data.base64, 'base64');
  if (bytes.length > 262144 || bytes.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1')
    invalid();
  const patients = data.source.patients.map(p => {
    if (
      typeof p?.name !== 'string' ||
      !p.name.trim() ||
      p.name.length > 2000 ||
      ['discharged', 'transferred', 'deceased'].some(k => typeof p[k] !== 'boolean')
    )
      invalid();
    return {
      name: p.name,
      discharged: p.discharged,
      transferred: p.transferred,
      deceased: p.deceased,
    };
  });
  const source = { date: data.source.date, patients };
  try {
    const parsed = parseCudyrCensusSource(readCudyrWorkbookMatrix(Uint8Array.from(bytes).buffer));
    if (!isDeepStrictEqual(parsed, source)) invalid();
  } catch {
    invalid();
  }
  const fileHash = createHash('sha256').update(bytes).digest('hex');
  const id = createHash('sha256')
    .update(JSON.stringify([source, fileHash, data.observedAt]))
    .digest('hex');
  return { id, source, fileHash, observedAt: data.observedAt, base64: data.base64 };
};
const saveCudyrCensusSource = async ({ hospital, data, actor, runTransaction }) => {
  const input = parseCensusSource(data);
  const ref = hospital.collection('cudyrCensusSources').doc(input.id);
  const file = hospital.collection('cudyrSupplementFiles').doc(input.fileHash);
  return runTransaction(async tx => {
    const prior = await tx.get(ref),
      priorFile = await tx.get(file);
    if (!prior.exists)
      tx.create(ref, {
        id: input.id,
        date: input.source.date,
        month: input.source.date.slice(0, 7),
        source: input.source,
        observedAt: input.observedAt,
        importedAt: new Date().toISOString(),
        importedBy: actor,
        fileHash: input.fileHash,
      });
    if (!priorFile.exists)
      tx.create(file, {
        schemaVersion: 1,
        base64: input.base64,
        sha256: input.fileHash,
        byteLength: Buffer.from(input.base64, 'base64').length,
      });
    return { persisted: true, id: input.id };
  });
};
const readCudyrCensusSources = async (hospital, data) => {
  if (data?.hospitalId !== undefined || !/^20\d{2}-(0[1-9]|1[0-2])$/.test(data?.month || ''))
    invalid();
  const { FieldPath } = require('firebase-admin/firestore');
  let q = hospital
    .collection('cudyrCensusSources')
    .where('month', '==', data.month)
    .orderBy(FieldPath.documentId());
  if (data.cursor !== undefined) {
    if (typeof data.cursor !== 'string' || !/^[a-f0-9]{64}$/.test(data.cursor)) invalid();
    q = q.startAfter(data.cursor);
  }
  const snapshot = await q.limit(33).get(),
    reports = snapshot.docs.slice(0, 32).map(d => d.data());
  await Promise.all(
    reports.map(async report => {
      const file = await hospital.collection('cudyrSupplementFiles').doc(report.fileHash).get();
      if (!file.exists) invalid();
      const parsed = parseCensusSource({
        confirmed: true,
        source: report.source,
        base64: file.data().base64,
        observedAt: report.observedAt,
      });
      if (
        parsed.fileHash !== report.fileHash ||
        parsed.id !== report.id ||
        report.date !== parsed.source.date
      )
        invalid();
    })
  );
  return { reports, nextCursor: snapshot.size > 32 ? reports.at(-1).id : null };
};
module.exports = { parseCensusSource, saveCudyrCensusSource, readCudyrCensusSources };
