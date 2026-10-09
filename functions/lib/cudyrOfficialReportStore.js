const functions = require('firebase-functions/v1');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const { monthValue } = require('./cudyrSupplementContract');
const POLICY = 2;
const fail = (message, code = 'failed-precondition') => {
  throw new functions.https.HttpsError(code, message);
};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bounds = month => {
  const [year, number] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  const next = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 10);
  return {
    from: month + '-01',
    to: last,
    next,
    months: [month, next.slice(0, 7)],
  };
};
const stamp = doc => [
  doc.ref.path,
  doc.exists === false
    ? 'missing'
    : String(doc.updateTime?.seconds) + ':' + String(doc.updateTime?.nanoseconds),
];
/** Server-side metadata check: no source bytes, parsers or report reconstruction on the read path. */
const sourceVersion = async (hospital, month, _episodes = [], transaction) => {
  const b = bounds(month);
  const reviewRef = hospital.collection('cudyrVerifiedContexts').doc(month);
  const review = transaction ? await transaction.get(reviewRef) : await reviewRef.get();
  // The official closure freezes the reconciled census and source clinical context.
  // Routine later census/capture refreshes do not reopen it. Explicit monthly recovery,
  // documentary revisions or daily exceptions require a new approved report revision.
  const queries = [
    hospital.collection('cudyrMonthlySupplements').where('month', 'in', b.months),
    // Immutable report archives written only by explicit Complete/verify month,
    // not the routine dailyRecords census synchronization.
    hospital
      .collection('cudyrCensusSources')
      .where('date', '>=', b.from)
      .where('date', '<=', b.next),
    hospital.collection('cudyrDailyExclusions').where('month', '==', month),
  ];
  const pages = await Promise.all(
    queries.map(q =>
      transaction ? transaction.get(q.select().limit(3001)) : q.select().limit(3001).get()
    )
  );
  if (pages.some(p => p.size > 3000)) fail('Too many monthly archive records.');
  const correctionVersionRef = hospital
    .collection('cudyrArchiveVersions')
    .doc('dischargeCorrections');
  const correctionVersion = transaction
    ? await transaction.get(correctionVersionRef)
    : await correctionVersionRef.get();
  const stamps = [review, correctionVersion, ...pages.flatMap(p => p.docs)]
    .map(stamp)
    .sort((a, b) => a[0].localeCompare(b[0]));
  return hash([POLICY, stamps]);
};
const fingerprint = (report, date) => {
  const coverage = report.coverage.find(d => d.date === date);
  const day = {
    date,
    state: coverage?.state,
    censusVerification: coverage?.censusVerification,
    documentaryReconstruction: coverage?.documentaryReconstruction,
  };
  return hash([
    2,
    date,
    report.rows
      .filter(r => r.date === date)
      .map(r => ({
        ...r,
        ...(r.verifiedContext ? { verifiedContext: { ...r.verifiedContext, revision: 0 } } : {}),
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    day,
    report.observations,
    report.captures,
    report.corrections,
    report.dischargeAudit,
    report.exclusions || [],
  ]);
};
const validateReport = (report, approval, month) => {
  const b = bounds(month);
  if (
    report?.schemaVersion !== 1 ||
    report.from !== b.from ||
    report.to !== b.to ||
    !Array.isArray(report.rows) ||
    report.rows.length > 5000 ||
    !Array.isArray(report.coverage) ||
    report.coverage.length !== Number(b.to.slice(-2)) ||
    !Array.isArray(report.issues) ||
    report.issues.length ||
    report.rows.some(
      r =>
        !r ||
        typeof r.date !== 'string' ||
        !/^\d{4}-\d\d-\d\d$/.test(r.date) ||
        r.eligibility === 'por_revisar' ||
        r.date < b.from ||
        r.date > b.to
    ) ||
    approval?.policyVersion !== 2
  )
    fail('Se requiere un informe mensual oficial completo.');
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Pacific/Easter',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  if (local < b.next + ' 12:00') fail('La ventana de aplicación del mes sigue abierta.');
  for (let i = 1; i <= Number(b.to.slice(-2)); i++) {
    const date = month + '-' + String(i).padStart(2, '0');
    if (
      report.coverage.filter(
        d => d.date === date && d.state === 'disponible' && d.reconstructionApproval
      ).length !== 1 ||
      approval.days.find(d => d.date === date)?.fingerprint !== fingerprint(report, date)
    )
      fail('El contenido cambió respecto del cierre aprobado.');
  }
};
const saveOfficialReport = async ({ hospital, data, actor }) => {
  if (!['admin', 'nurse_hospital'].includes(actor.role))
    fail('Review permission required.', 'permission-denied');
  if (data.hospitalId !== undefined || data.schemaVersion !== 1)
    fail('Invalid report request.', 'invalid-argument');
  const month = monthValue(data.month),
    report = data.report;
  const episodes = [
    ...new Set((report?.rows || []).map(r => r.clinicalEpisodeId).filter(Boolean)),
  ].sort();
  if (episodes.length > 500) fail('Too many episodes.');
  const ref = hospital.collection('cudyrOfficialReports').doc(month);
  return hospital.firestore.runTransaction(async tx => {
    const [review, prior] = await Promise.all([
      tx.get(hospital.collection('cudyrVerifiedContexts').doc(month)),
      tx.get(ref),
    ]);
    validateReport(report, review.data()?.censusApproval, month);
    const version = await sourceVersion(hospital, month, episodes, tx);
    if (data.sourceVersion !== version)
      fail('Las fuentes cambiaron; vuelva a cargar el mes.', 'aborted');
    // Concurrent publishers reuse the same authoritative artifact; no last-writer replacement.
    if (
      prior.exists &&
      prior.data().policyVersion === POLICY &&
      prior.data().sourceVersion === version
    ) {
      const existing = prior.data();
      return {
        persisted: true,
        version: existing.version,
        savedAt: existing.savedAt,
        sourceVersion: version,
        report: existing.report,
      };
    }
    const clean = {
      ...report,
      coverage: report.coverage.map(day => ({
        ...day,
        reconstructionApproval: {
          approvedAt: review.data().censusApproval.approvedAt,
          approvedBy: review.data().censusApproval.approvedBy.name,
          reason: review.data().censusApproval.reason,
        },
      })),
    };
    delete clean.officialSnapshot;
    delete clean.loadedAt;
    delete clean.cacheVerificationRequired;
    const bytes = Buffer.from(JSON.stringify(clean));
    if (bytes.length > 8_000_000) fail('Report too large.', 'resource-exhausted');
    const packed = gzipSync(bytes);
    if (packed.length > 650_000) fail('Report archive too large.', 'resource-exhausted');
    const snapshot = {
      schemaVersion: 1,
      policyVersion: POLICY,
      month,
      sourceVersion: version,
      version: hash([version, clean]),
      savedAt: new Date().toISOString(),
      savedBy: actor,
      episodes,
      encoding: 'gzip-base64',
      report: packed.toString('base64'),
    };
    tx.create(ref.collection('versions').doc(snapshot.version), snapshot);
    tx.set(ref, snapshot);
    return {
      persisted: true,
      version: snapshot.version,
      savedAt: snapshot.savedAt,
      sourceVersion: version,
      report: snapshot.report,
    };
  });
};
const readOfficialReport = async (hospital, data) => {
  if (data.hospitalId !== undefined) fail('Invalid report request.', 'invalid-argument');
  const month = monthValue(data.month);
  return hospital.firestore.runTransaction(async tx => {
    const doc = await tx.get(hospital.collection('cudyrOfficialReports').doc(month));
    const snapshot = doc.data();
    const episodes = snapshot?.episodes || data.episodes || [];
    if (
      !Array.isArray(episodes) ||
      episodes.length > 500 ||
      episodes.some(id => typeof id !== 'string' || id.length > 120)
    )
      fail('Invalid episodes.', 'invalid-argument');
    const version = await sourceVersion(hospital, month, episodes, tx);
    if (!snapshot || snapshot.policyVersion !== POLICY || snapshot.sourceVersion !== version)
      return { state: 'missing', sourceVersion: version };
    return {
      state: data.knownVersion === snapshot.version ? 'unchanged' : 'ready',
      sourceVersion: version,
      version: snapshot.version,
      savedAt: snapshot.savedAt,
      ...(data.knownVersion === snapshot.version
        ? {}
        : { encoding: snapshot.encoding, report: snapshot.report }),
    };
  });
};
module.exports = {
  saveOfficialReport,
  readOfficialReport,
  sourceVersion,
  validateReport,
  fingerprint,
  bounds,
};
