const functions = require('firebase-functions/v1');
const SOURCE = 'Eloísa · informe mensual';
const DOCUMENTARY_FIELD_CONTRACT_VERSION = 3;
const documentKey = value =>
  String(value || '')
    .replace(/[.\s-]/g, '')
    .toUpperCase();
const nameKey = value =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9Ñ]+/)
    .filter(Boolean)
    .sort()
    .join(' ');
const nextCalendarDay = day => {
  const [year, month, date] = day.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
};
const identities = record => [
  ...Object.values(record.beds || {}).flatMap(p =>
    p?.clinicalCrib ? [p, p.clinicalCrib] : p ? [p] : []
  ),
  ...[...(record.discharges || []), ...(record.transfers || []), ...(record.cma || [])].flatMap(
    m =>
      m.deletedAt
        ? []
        : [
            {
              rut: m.rut,
              patientName: m.patientName,
              clinicalEpisodeId: m.clinicalEpisodeId || m.originalData?.clinicalEpisodeId,
              documentType: m.documentType,
              neonatalMaternalRut: m.neonatalMaternalRut,
            },
            ...(m.originalData
              ? [
                  m.originalData,
                  ...(m.originalData.clinicalCrib ? [m.originalData.clinicalCrib] : []),
                ]
              : []),
          ]
  ),
];
const documentaryTargets = payload =>
  payload.patches.filter(target => {
    const cudyr = target.fields?.evaluationScores?.cudyr;
    return cudyr?.source === SOURCE || cudyr?.documentaryEvidence;
  });

/** The source calendar day and owning night are one atomic identity context, including creation. */
const assertDocumentaryCudyrAuthority = async ({
  payload,
  record,
  hospitalRef,
  read,
  authorityRecord,
  valuesEqual,
}) => {
  for (const target of payload.patches) {
    if (!Object.prototype.hasOwnProperty.call(target.fields, 'evaluationScores')) continue;
    const patient = target.clinicalCrib
      ? record.beds?.[target.bedId]?.clinicalCrib
      : record.beds?.[target.bedId];
    if (patient?.evaluationScores?.cudyr?.source !== SOURCE) continue;
    const requested = target.fields.evaluationScores;
    const hasCudyr = requested && Object.prototype.hasOwnProperty.call(requested, 'cudyr');
    const legacyPreservesOmission =
      payload.fieldContractVersion < 2 &&
      requested &&
      typeof requested === 'object' &&
      !Array.isArray(requested) &&
      Object.keys(requested).length > 0 &&
      !hasCudyr;
    if (
      !(requested?.cudyr && valuesEqual(patient.evaluationScores.cudyr, requested.cudyr)) &&
      !legacyPreservesOmission
    )
      throw new functions.https.HttpsError(
        'failed-precondition',
        'An accepted documentary CUDYR cannot be replaced or removed by synchronization.'
      );
  }
  const targets = documentaryTargets(payload).filter(target => {
    const patient = target.clinicalCrib
      ? record.beds?.[target.bedId]?.clinicalCrib
      : record.beds?.[target.bedId];
    const current = patient?.evaluationScores?.cudyr;
    const proposed = target.fields.evaluationScores.cudyr;
    // Existing accepted documentary scores may be echoed while an adjacent scale changes.
    return !current || !valuesEqual(current, proposed);
  });
  if (!targets.length) return;
  const reject = () => {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Documentary CUDYR requires an unambiguous, missing result across the owning night and source day.'
    );
  };
  if (payload.fieldContractVersion !== DOCUMENTARY_FIELD_CONTRACT_VERSION) reject();
  const sourceDate = nextCalendarDay(payload.date);
  const sourceRecord =
    sourceDate === payload.authorityDate
      ? authorityRecord
      : (await read(hospitalRef.collection('dailyRecords').doc(sourceDate))).data();
  const context = [record, ...(sourceRecord ? [sourceRecord] : [])];
  if (
    record.cudyrLocked ||
    record.cudyrCompletedAt ||
    record.medicalSignature ||
    Object.values(record.medicalSignatureByScope || {}).some(Boolean)
  )
    reject();
  for (const target of targets) {
    const patient = target.clinicalCrib
      ? record.beds?.[target.bedId]?.clinicalCrib
      : record.beds?.[target.bedId];
    const cudyr = target.fields.evaluationScores.cudyr;
    const proof = cudyr.documentaryEvidence;
    if (
      !patient ||
      patient.documentType !== 'RUT' ||
      patient.neonatalMaternalRut ||
      patient.identityStatus === 'provisional' ||
      patient.clinicalEpisodeId !== target.clinicalEpisodeId ||
      patient.cudyr ||
      patient.evaluationScores?.cudyr ||
      cudyr.source !== SOURCE ||
      !proof ||
      !proof.reportId ||
      !Number.isInteger(proof.sourceRow) ||
      proof.documentType !== 'RUT' ||
      proof.sourceDate !== sourceDate ||
      cudyr.recordedDate !== payload.date ||
      typeof proof.document !== 'string' ||
      typeof proof.patientName !== 'string' ||
      !nameKey(patient.patientName) ||
      documentKey(proof.document) !== documentKey(patient.rut) ||
      nameKey(proof.patientName) !== nameKey(patient.patientName) ||
      proof.clinicalEpisodeId !== target.clinicalEpisodeId ||
      !/^[A-D][1-3]$/.test(cudyr.category) ||
      cudyr.recordedAt ||
      cudyr.author ||
      cudyr.authorRole ||
      cudyr.items ||
      cudyr.history
    )
      reject();
    const sameDocument = context
      .flatMap(identities)
      .filter(p => documentKey(p.rut) === documentKey(patient.rut));
    if (
      !documentKey(patient.rut) ||
      sameDocument.some(
        p =>
          p.documentType === 'Pasaporte' ||
          p.neonatalMaternalRut ||
          p.clinicalEpisodeId !== target.clinicalEpisodeId ||
          nameKey(p.patientName) !== nameKey(patient.patientName)
      )
    )
      reject();
    const bedMatches = Object.values(record.beds || {})
      .flatMap(p => [p, p?.clinicalCrib])
      .filter(p => p?.clinicalEpisodeId === target.clinicalEpisodeId);
    if (bedMatches.length !== 1) reject();
  }
};
module.exports = { DOCUMENTARY_FIELD_CONTRACT_VERSION, assertDocumentaryCudyrAuthority };
