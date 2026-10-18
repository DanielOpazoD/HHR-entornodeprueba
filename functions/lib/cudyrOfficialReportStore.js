const functions = require('firebase-functions/v1');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const { monthValue } = require('./cudyrSupplementContract');
const { matchesRestoreBinding } = require('./cudyrOfficialRestore');
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
const sourceDocuments = async (
  hospital,
  month,
  episodes = [],
  transaction,
  includeContent = false
) => {
  const select = query => (includeContent ? query : query.select());
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
      transaction ? transaction.get(select(q).limit(3001)) : select(q).limit(3001).get()
    )
  );
  if (pages.some(p => p.size > 3000)) fail('Too many monthly archive records.');
  const correctionVersionRef = hospital
    .collection('cudyrArchiveVersions')
    .doc('dischargeCorrections');
  const correctionVersion = transaction
    ? await transaction.get(correctionVersionRef)
    : await correctionVersionRef.get();
  // Keep the legacy hospital marker frozen in the fingerprint: upgrading does not
  // reopen existing official months. Legacy writers still invalidate safely.
  // Query only changed episode markers, in bounded Firestore `in` batches.
  const ids = [...new Set(episodes)];
  const correctionPages = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / 30) }, (_, index) => {
      const q = select(
        hospital
          .collection('cudyrArchiveVersions')
          .where('clinicalEpisodeId', 'in', ids.slice(index * 30, (index + 1) * 30))
      ).limit(31);
      return transaction ? transaction.get(q) : q.get();
    })
  );
  if (correctionPages.some(p => p.size > 30)) fail('Too many episode revision markers.');
  return [
    review,
    correctionVersion,
    ...pages.flatMap(p => p.docs),
    ...correctionPages.flatMap(p => p.docs),
  ];
};
const versionsForDocuments = (hospital, docs) => {
  const correctionVersionRef = hospital
    .collection('cudyrArchiveVersions')
    .doc('dischargeCorrections');
  const correctionVersion = docs.find(doc => doc.ref.path === correctionVersionRef.path);
  const hasEpisodeCorrections = docs.some(
    doc =>
      doc.exists !== false &&
      doc.ref.path.startsWith(correctionVersionRef.path.slice(0, -'dischargeCorrections'.length)) &&
      doc.ref.path !== correctionVersionRef.path
  );
  const stamps = docs.map(stamp).sort((a, b) => a[0].localeCompare(b[0]));
  return {
    current: hash([POLICY, stamps]),
    // Before revision markers existed, official snapshots omitted this missing
    // document. Accept that exact metadata fingerprint only while no legacy or
    // relevant episode correction marker exists. Never rewrite the artifact.
    legacy:
      correctionVersion.exists === false && !hasEpisodeCorrections
        ? hash([POLICY, stamps.filter(([path]) => path !== correctionVersionRef.path)])
        : undefined,
  };
};
const sourceVersions = async (hospital, month, episodes = [], transaction) =>
  versionsForDocuments(hospital, await sourceDocuments(hospital, month, episodes, transaction));
const sourceVersion = async (hospital, month, episodes = [], transaction) =>
  (await sourceVersions(hospital, month, episodes, transaction)).current;
// A reconstruction starts before its full episode set is known. Keep a separate
// publication guard so any correction during that read aborts stale publication,
// while an already saved official report checks only its own episodes.
const publicationVersion = async (hospital, month, transaction) => {
  const base = await sourceVersion(hospital, month, [], transaction);
  const ref = hospital.collection('cudyrArchiveVersions').doc('dischargePublication');
  const progress = transaction ? await transaction.get(ref) : await ref.get();
  return progress.exists ? hash([base, stamp(progress)]) : base;
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
    if (data.sourceVersion !== (await publicationVersion(hospital, month, tx)))
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
// A refreshed following-month workbook must not reopen a closed month when its
// only relevant column (the following first morning) is unchanged. Keep exact
// metadata validation for every other source and for the original workbooks.
const unchangedFollowingMorning = (docs, snapshot, month) => {
  const next = bounds(month).next;
  const savedAt = Date.parse(snapshot.savedAt);
  if (!Number.isFinite(savedAt)) return null;
  const sources = docs.filter(
    doc =>
      doc.ref.path.includes('/cudyrMonthlySupplements/') && doc.data()?.month === next.slice(0, 7)
  );
  const prior = sources.filter(doc => Date.parse(doc.data().importedAt) <= savedAt);
  const added = sources.filter(doc => Date.parse(doc.data().importedAt) > savedAt);
  if (!prior.length || !added.length) return null;
  const column = doc => {
    const source = doc.data();
    if (
      source.capture?.source !== 'extension_monthly_report' ||
      !Array.isArray(source.report?.patients)
    )
      return null;
    const entries = [];
    for (const patient of source.report.patients) {
      if (!Array.isArray(patient.days)) return null;
      const cells = patient.days.filter(day => day.sourceDate === next);
      if (cells.length !== 1) return null;
      const category = cells[0].category;
      // Later admissions add blank rows to the workbook, not applications to
      // the already closed night. Any added/removed/changed positive invalidates.
      if (category) entries.push(JSON.stringify([patient.document, patient.patientName, category]));
    }
    return JSON.stringify(entries.sort());
  };
  prior.sort((a, b) => Date.parse(b.data().importedAt) - Date.parse(a.data().importedAt));
  const expected = column(prior[0]);
  if (expected === null || added.some(doc => column(doc) !== expected)) return null;
  const excluded = new Set(added.map(doc => doc.ref.path));
  return docs.filter(doc => !excluded.has(doc.ref.path));
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
    const versions = await sourceVersions(hospital, month, episodes, tx);
    const originalMatches =
      snapshot &&
      (snapshot.sourceVersion === versions.current ||
        (versions.legacy && snapshot.sourceVersion === versions.legacy));
    let followingMorningMatches = false;
    if (snapshot?.policyVersion === POLICY && !originalMatches) {
      const documents = await sourceDocuments(hospital, month, episodes, tx, true);
      const unchanged = unchangedFollowingMorning(documents, snapshot, month);
      if (unchanged) {
        const previous = versionsForDocuments(hospital, unchanged);
        followingMorningMatches =
          snapshot.sourceVersion === previous.current ||
          Boolean(previous.legacy && snapshot.sourceVersion === previous.legacy);
      }
    }
    let restoredMatches = false;
    if (snapshot?.policyVersion === POLICY && !originalMatches && !followingMorningMatches) {
      const binding = await tx.get(
        hospital
          .collection('cudyrOfficialReports')
          .doc(month)
          .collection('restorations')
          .doc(versions.current)
      );
      restoredMatches = matchesRestoreBinding(
        binding.data(),
        hospital,
        month,
        snapshot,
        versions.current,
        doc
      );
    }
    if (
      !snapshot ||
      snapshot.policyVersion !== POLICY ||
      (!originalMatches && !followingMorningMatches && !restoredMatches)
    )
      return { state: 'missing', sourceVersion: await publicationVersion(hospital, month, tx) };
    const version = snapshot.sourceVersion;
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
  unchangedFollowingMorning,
  sourceVersion,
  sourceDocuments,
  versionsForDocuments,
  validateReport,
  fingerprint,
  bounds,
};
