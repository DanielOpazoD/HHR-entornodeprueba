const functions = require('firebase-functions/v1');
const { createHash } = require('node:crypto');
const invalid = () => {
  throw new functions.https.HttpsError('invalid-argument', 'Invalid monthly CUDYR supplement.');
};
const digest = value =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex');
const text = (value, max = 2000, required = false) => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) invalid();
  return value;
};
const integer = (value, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid();
  return value;
};
const monthValue = value => {
  if (typeof value !== 'string' || !/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(value)) invalid();
  return value;
};
const parseReport = value => {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    value.source !== 'eloisa_monthly_report' ||
    typeof value.establishment !== 'string' ||
    value.establishment.toLowerCase().replace(/\s+/g, ' ').trim() !==
      'hospital hanga roa (isla de pascua)' ||
    !Array.isArray(value.patients) ||
    !value.patients.length ||
    value.patients.length > 500 ||
    Buffer.byteLength(JSON.stringify(value), 'utf8') > 500_000
  )
    invalid();
  const month = monthValue(value.month);
  const [year, number] = month.split('-').map(Number);
  const totalDays = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const patients = value.patients.map(patient => {
    if (!patient || !Array.isArray(patient.days) || patient.days.length !== totalDays) invalid();
    const days = patient.days
      .map(day => {
        const sourceDay = integer(day?.sourceDay, 1, totalDays);
        const sourceDate = `${month}-${String(sourceDay).padStart(2, '0')}`;
        const originalValue = text(day.originalValue, 20);
        const category = /^[A-D][1-3]$/i.test(originalValue) ? originalValue.toUpperCase() : null;
        const state = category
          ? 'category'
          : /^s\s*\/\s*c$/i.test(originalValue)
            ? 'uncategorized'
            : 'blank';
        if (
          (state === 'blank' && originalValue !== '') ||
          day.sourceDate !== sourceDate ||
          day.category !== category ||
          day.state !== state
        )
          invalid();
        return {
          sourceDay,
          sourceColumn: integer(day.sourceColumn, 1, 100),
          sourceDate,
          originalValue,
          category,
          state,
        };
      })
      .sort((a, b) => a.sourceDay - b.sourceDay);
    if (
      new Set(days.map(day => day.sourceDay)).size !== totalDays ||
      new Set(days.map(day => day.sourceColumn)).size !== totalDays
    )
      invalid();
    return {
      sourceRow: integer(patient.sourceRow, 1, 5000),
      ordinal: integer(patient.ordinal, 1, 5000),
      patientName: text(patient.patientName, 2000, true),
      clinicalRecord: text(patient.clinicalRecord),
      document: text(patient.document),
      diagnosis: text(patient.diagnosis),
      hospitalDays: text(patient.hospitalDays),
      service: text(patient.service),
      dischargeCondition: text(patient.dischargeCondition),
      days,
    };
  });
  if (
    new Set(patients.map(patient => patient.sourceRow)).size !== patients.length ||
    new Set(patients.map(patient => patient.ordinal)).size !== patients.length
  )
    invalid();
  return {
    schemaVersion: 1,
    source: 'eloisa_monthly_report',
    month,
    establishment: value.establishment,
    generatedLabel: text(value.generatedLabel, 200),
    sheet: text(value.sheet, 100, true),
    patients,
  };
};

const parseSupplementImport = data => {
  if (
    data?.schemaVersion !== 1 ||
    data.hospitalId !== undefined ||
    data.confirmed !== true ||
    typeof data.operationId !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data.operationId)
  )
    invalid();
  const fileName = text(data.file?.name, 200, true);
  const base64 = text(data.file?.base64, 349528, true);
  if (
    !/\.(xls|xlsx)$/i.test(fileName) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)
  )
    invalid();
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > 262144 || bytes.length < 8 || bytes.toString('base64') !== base64) invalid();
  const isXls = bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'));
  const isXlsx = bytes.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'));
  if (/\.xls$/i.test(fileName) ? !isXls : !isXlsx) invalid();
  const report = parseReport(data.report);
  const semanticPatients = report.patients
    .map(({ sourceRow: _row, ordinal: _ordinal, days, ...patient }) => ({
      ...patient,
      days: days.map(({ sourceDate, category, state }) => ({ sourceDate, category, state })),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
  const contentId = digest([report.month, report.establishment, semanticPatients]);
  const fileHash = digest(bytes);
  const versionId = digest([contentId, fileHash, report]);
  return {
    report,
    contentId,
    versionId,
    fileHash,
    fileName,
    base64,
    byteLength: bytes.length,
    operationId: data.operationId,
    requestHash: digest([report, fileHash, fileName]),
  };
};

module.exports = { parseSupplementImport, parseReport, monthValue, digest, invalid };
