const {
  resolveClinicalDayForDateTime,
  calendarStampInClinicalTimeZone,
} = require('./generated/cudyrSourceParser.cjs');
const functions = require('firebase-functions/v1');
const { digest, monthValue, verifySupplementBytes } = require('./cudyrSupplementContract');
const fail = (message = 'Invalid verified CUDYR context.', code = 'invalid-argument') => {
  throw new functions.https.HttpsError(code, message);
};
const str = (value, max, optional = false) => {
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) fail();
  return value.trim();
};
const hash = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail();
  return value;
};
const documentKey = value =>
  String(value || '')
    .replace(/[.\s-]/g, '')
    .toUpperCase();
const nameKey = value =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
const timestamp = value => {
  if (typeof value !== 'string') fail();
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value
    );
  if (!match) fail();
  const [, y, m, d, h, minute, second, , zone] = match;
  const calendar = new Date(`${y}-${m}-${d}T00:00:00Z`);
  if (
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== `${y}-${m}-${d}` ||
    Number(h) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59
  )
    fail();
  if (zone !== 'Z') {
    const hours = Number(zone.slice(1, 3)),
      minutes = Number(zone.slice(4, 6));
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) fail();
  }
  if (!Number.isFinite(Date.parse(value))) fail();
  return value;
};
const parseVerifiedContext = data => {
  if (data.schemaVersion !== 1 || data.confirmed !== true || data.hospitalId !== undefined) fail();
  const month = monthValue(data.month);
  const action = data.action;
  if (data.reconstructedDays !== undefined && !Array.isArray(data.reconstructedDays)) fail();
  const reason = str(data.reason, 1800);
  if (!['replace', 'withdraw'].includes(action) || reason.length < 20) fail();
  if (!Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0) fail();
  const operationId = str(data.operationId, 100);
  if (!/^[a-zA-Z0-9-]{16,100}$/.test(operationId)) fail();
  if (
    !Array.isArray(data.entries) ||
    data.entries.length > 100 ||
    !Array.isArray(data.files) ||
    data.files.length > 30
  )
    fail();
  if (action === 'replace' && !data.entries.length)
    fail('An ordinary review must contain evidenced entries.');
  if (
    action === 'withdraw' &&
    (data.entries.length || data.files.length || data.reconstructedDays?.length)
  )
    fail('Withdrawal must explicitly clear the snapshot.');
  const files = data.files.map(file => {
    const name = str(file.name, 240),
      base64 = str(file.base64, 900000);
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.toString('base64') !== base64 || !/\.(pdf|json)$/i.test(name))
      fail();
    if (/\.pdf$/i.test(name) && bytes.subarray(0, 5).toString() !== '%PDF-') fail();
    if (/\.json$/i.test(name)) {
      try {
        JSON.parse(bytes.toString('utf8'));
      } catch {
        fail();
      }
    }
    return { name, base64, sha256: digest(bytes), byteLength: bytes.length };
  });
  if (files.reduce((n, f) => n + f.byteLength, 0) > 5000000) fail();
  const entries = data.entries.map(e => {
    const date = str(e.date, 10);
    if (
      !date.startsWith(month + '-') ||
      !/^\d{4}-\d\d-\d\d$/.test(date) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      fail();
    const reportAbsence = e.sourceRow === null && e.basis === 'reviewed_report_absence';
    if (!reportAbsence && (!Number.isSafeInteger(e.sourceRow) || e.sourceRow < 1)) fail();
    if (reportAbsence && (!str(e.document, 100).length || !str(e.patientName, 240).length)) fail();
    if (
      !['hospitalizacion', 'cuna', 'cma', 'uea'].includes(e.modality) ||
      !['media', 'intermedia', 'sin_grupo'].includes(e.group)
    )
      fail();
    if (
      e.maternalSourceRow !== undefined &&
      (!reportAbsence ||
        e.modality !== 'cuna' ||
        !Number.isSafeInteger(e.maternalSourceRow) ||
        e.maternalSourceRow < 1)
    )
      fail();
    if (e.modality !== 'hospitalizacion' && e.group !== 'sin_grupo') fail();
    if (e.modality === 'hospitalizacion' && e.group === 'sin_grupo') fail();
    if (
      !Array.isArray(e.evidenceHashes) ||
      !e.evidenceHashes.length ||
      e.evidenceHashes.length > 10 ||
      e.evidenceHashes.some(h => !files.some(f => f.sha256 === hash(h)))
    )
      fail();
    const admissionAt = timestamp(e.admissionAt),
      dischargeAt = timestamp(e.dischargeAt);
    if (Date.parse(dischargeAt) <= Date.parse(admissionAt)) fail();
    const startStamp = calendarStampInClinicalTimeZone(new Date(admissionAt));
    const endStamp = calendarStampInClinicalTimeZone(new Date(Date.parse(dischargeAt) - 1));
    if (
      resolveClinicalDayForDateTime(startStamp.iso, startStamp.hhmm) > date ||
      resolveClinicalDayForDateTime(endStamp.iso, endStamp.hhmm) < date
    )
      fail('Documentary stay does not overlap the reviewed clinical day.');
    if (!/^\d{1,30}$/.test(e.clinicalEpisodeId)) fail();
    const reason = str(e.reason, 1800);
    if (reason.length < 20 || !(reportAbsence || e.basis === 'reviewed_documentary_context'))
      fail();
    if (!reportAbsence && e.basis !== 'reviewed_documentary_context') fail();
    if (e.category !== undefined || e.evaluation !== undefined || e.author !== undefined)
      fail('Context reviews cannot create CUDYR results.');
    return {
      date,
      reportId: hash(e.reportId),
      sourceRow: e.sourceRow,
      ...(e.maternalSourceRow !== undefined ? { maternalSourceRow: e.maternalSourceRow } : {}),
      ...(reportAbsence ? { patientName: str(e.patientName, 240) } : {}),
      clinicalEpisodeId: e.clinicalEpisodeId,
      admissionAt,
      dischargeAt,
      group: e.group,
      modality: e.modality,
      bedId: str(e.bedId, 100, true),
      bedName: str(e.bedName, 200, true),
      document: str(e.document, 100, true),
      documentType: str(e.documentType, 100, true),
      reason,
      basis: e.basis,
      evidenceHashes: e.evidenceHashes.map(hash),
    };
  });
  if (
    new Set(entries.map(e => `${e.date}:${e.reportId}:${e.sourceRow ?? e.clinicalEpisodeId}`))
      .size !== entries.length ||
    new Set(entries.map(e => `${e.date}:${e.clinicalEpisodeId}`)).size !== entries.length
  )
    fail();
  const reconstructedDays = (data.reconstructedDays || []).map(d => {
    const date = str(d.date, 10),
      reason = str(d.reason, 1800);
    if (
      !date.startsWith(month + '-') ||
      !/^\d{4}-\d\d-\d\d$/.test(date) ||
      new Date(date).toISOString().slice(0, 10) !== date ||
      reason.length < 20 ||
      !Array.isArray(d.evidenceHashes) ||
      !d.evidenceHashes.length ||
      d.evidenceHashes.length > 10 ||
      d.evidenceHashes.some(h => !files.some(f => f.sha256 === hash(h)))
    )
      fail();
    return { date, reason, evidenceHashes: d.evidenceHashes.map(hash) };
  });
  if (
    reconstructedDays.length > 31 ||
    new Set(reconstructedDays.map(d => d.date)).size !== reconstructedDays.length
  )
    fail();
  return {
    month,
    action,
    reason,
    operationId,
    expectedRevision: data.expectedRevision,
    entries,
    files,
    reconstructedDays,
  };
};

/** Reviewed census context only; original scores/censuses are never overwritten. */
const saveCudyrVerifiedContext = async ({ hospital, data, actor, runTransaction }) => {
  const input = parseVerifiedContext(data);
  const ref = hospital.collection('cudyrVerifiedContexts').doc(input.month);
  const audit = ref.collection('revisions').doc(digest([actor.uid, input.operationId]));
  const requestHash = digest(input);
  return runTransaction(async tx => {
    const receipt = await tx.get(audit);
    if (receipt.exists) {
      if (receipt.data().requestHash !== requestHash)
        fail('Operation content changed.', 'already-exists');
      return { persisted: true, revision: receipt.data().review.revision };
    }
    const current = await tx.get(ref);
    if ((current.exists ? current.data().revision : 0) !== input.expectedRevision)
      fail('La conciliación cambió; recargue antes de guardar.', 'aborted');
    for (const id of new Set(input.entries.map(e => e.reportId))) {
      const source = await tx.get(hospital.collection('cudyrMonthlySupplements').doc(id));
      if (!source.exists) fail('Monthly source is missing.', 'failed-precondition');
      const s = source.data();
      const file = await tx.get(hospital.collection('cudyrSupplementFiles').doc(s.file.sha256));
      if (!file.exists || s.capture?.source !== 'extension_monthly_report') fail();
      const bytes = Buffer.from(file.data().base64, 'base64');
      if (digest(bytes) !== s.file.sha256) fail();
      verifySupplementBytes(bytes, s.report);
      for (const e of input.entries.filter(e => e.reportId === id)) {
        const next = new Date(Date.parse(e.date + 'T12:00:00Z') + 86400000)
          .toISOString()
          .slice(0, 10);
        if (e.basis === 'reviewed_report_absence') {
          const mother = s.report.patients.find(p => p.sourceRow === e.maternalSourceRow);
          const maternalBinding =
            e.modality === 'cuna' &&
            mother &&
            documentKey(mother.document) === documentKey(e.document) &&
            !/^(RN|RECI[EÉ]N NACID[OA])\b/i.test(String(mother.patientName).trim()) &&
            nameKey(mother.patientName) !== nameKey(e.patientName);
          if (e.maternalSourceRow !== undefined && !maternalBinding)
            fail('Invalid documentary maternal identity.', 'failed-precondition');
          if (
            s.report.month !== next.slice(0, 7) ||
            s.report.patients.some(
              p =>
                !(maternalBinding && p.sourceRow === e.maternalSourceRow) &&
                (documentKey(p.document) === documentKey(e.document) ||
                  nameKey(p.patientName) === nameKey(e.patientName))
            )
          )
            fail('The report does not support an absent patient identity.', 'failed-precondition');
          continue;
        }
        const p = s.report.patients.find(p => p.sourceRow === e.sourceRow);
        const cell = p?.days.find(d => d.sourceDate === next);
        if (!cell || !['category', 'blank'].includes(cell.state)) fail('No valid source cell.');
      }
    }
    const review = {
      schemaVersion: 1,
      month: input.month,
      action: input.action,
      reason: input.reason,
      revision: input.expectedRevision + 1,
      entries: input.entries,
      reconstructedDays: input.reconstructedDays,
      files: input.files.map(({ base64, ...f }) => f),
      reviewedBy: actor,
      updatedAt: new Date().toISOString(),
      verification: 'reviewed_documentary_context',
    };
    for (const f of input.files)
      tx.set(hospital.collection('cudyrContextEvidence').doc(f.sha256), f);
    tx.set(ref, review);
    tx.create(audit, { requestHash, review });
    return { persisted: true, revision: review.revision };
  });
};
const readCudyrVerifiedContext = async (hospital, data) => {
  if (data.hospitalId !== undefined) fail();
  const ref = hospital.collection('cudyrVerifiedContexts').doc(monthValue(data.month));
  const snapshot = await ref.get();
  return { review: snapshot.exists ? snapshot.data() : null };
};
module.exports = { parseVerifiedContext, saveCudyrVerifiedContext, readCudyrVerifiedContext };
