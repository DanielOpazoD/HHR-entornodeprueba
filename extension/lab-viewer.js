/**
 * Pure contracts and analytics for the native Eloisa laboratory viewer.
 * UMD keeps the same implementation available to the MV3 worker, content script and Vitest.
 */
(function (root, factory) {
  const api = factory(root.HhrLabResultParser);
  root.HhrLabViewer = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function (resultParser) {
  'use strict';
  if (!resultParser) throw new Error('No se pudo cargar el parser clínico de Syslab.');
  const {
    comparisonToken,
    extractRutBodyFromReportText,
    findingAlert,
    isSystemicTrendEligible,
    normalizeAnalysisName,
    parseMeasurement,
    parseReportText,
  } = resultParser;
  const IMPORTANT_ANALYSES = [
    'Recuento Leucocitos', 'Hemoglobina', 'Hematocrito', 'VCM', 'HCM',
    'Recuento de Plaquetas', 'Segmentados', 'Linfocitos', 'Proteina C Reactiva',
    'VHS', 'Creatinina', 'Nitrogeno Ureico', 'Uremia', 'Sodio', 'Potasio',
    'Cloro', 'HCO3', 'Calcio', 'Fosforo', 'pH', 'pCO2', 'pO2', 'Lactato',
    'ASAT/GOT', 'ALAT/GPT', 'GGT', 'Fosfatasa Alcalina', 'Bilirrubinas',
    'Protrombina', 'TTPK', 'INR', 'Albumina', 'Proteinas Totales', 'Troponina',
    'Dimero', 'CK Total', 'Magnesio', 'TSH', 'T4L', 'Acido Urico', 'Glicemia',
    'Hb glicosilada', 'Colesterol Total', 'LDL', 'HDL', 'TG', 'RAC', 'RPC',
  ];
  const cleanText = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const normalizeRutBody = value => cleanText(value)
    .replace(/\./g, '')
    .replace(/-.*$/, '')
    .replace(/\D/g, '');
  const normalizePatientRutBody = value => {
    const raw = cleanText(value).toUpperCase();
    if (raw.includes('-')) return normalizeRutBody(raw);
    const compact = raw.replace(/[^0-9K]/g, '');
    if (!/^\d{6,8}[0-9K]$/.test(compact)) return normalizeRutBody(raw);
    const body = compact.slice(0, -1);
    let sum = 0;
    let multiplier = 2;
    for (let index = body.length - 1; index >= 0; index -= 1) {
      sum += Number(body[index]) * multiplier;
      multiplier = multiplier === 7 ? 2 : multiplier + 1;
    }
    const remainder = 11 - (sum % 11);
    const verifier = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
    return verifier === compact.slice(-1) ? body : normalizeRutBody(raw);
  };
  const parseDate = (date, time) => {
    const match = cleanText(date).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return 0;
    const timeMatch = cleanText(time).match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    return new Date(
      Number(match[3]), Number(match[2]) - 1, Number(match[1]),
      timeMatch ? Number(timeMatch[1]) : 0,
      timeMatch ? Number(timeMatch[2]) : 0,
      timeMatch && timeMatch[3] ? Number(timeMatch[3]) : 0
    ).getTime();
  };
  const sanitizeExamList = exams => (Array.isArray(exams) ? exams : [])
    .filter(exam => exam && /^\d+$/.test(String(exam.id || '')))
    .map(exam => ({
      id: String(exam.id),
      date: cleanText(exam.date),
      time: cleanText(exam.time),
      patientName: cleanText(exam.patientName),
      origin: cleanText(exam.origin),
      exams: (Array.isArray(exam.exams) ? exam.exams : []).slice(0, 80).map(cleanText).filter(Boolean),
    }))
    .sort((a, b) => parseDate(b.date, b.time) - parseDate(a.date, a.time))
    .slice(0, 100);
  const examRowsMatchRut = (exams, expectedRutBody) => {
    const expected = normalizeRutBody(expectedRutBody);
    return /^\d{5,9}$/.test(expected) && Array.isArray(exams) && exams.every(exam =>
      exam && normalizeRutBody(exam.rutBody) === expected
    );
  };
  const validateDetailBatch = (details, expectedExamIds, expectedRutBody) => {
    const examIds = (Array.isArray(expectedExamIds) ? expectedExamIds : []).map(String);
    const expectedRut = normalizeRutBody(expectedRutBody);
    if (
      !examIds.length ||
      new Set(examIds).size !== examIds.length ||
      !/^\d{5,9}$/.test(expectedRut) ||
      !Array.isArray(details)
    ) return null;
    if (details.length !== examIds.length) return null;
    const expected = new Set(examIds);
    const detailsByExamId = new Map();
    for (const detail of details) {
      if (!detail || typeof detail !== 'object') return null;
      const examId = String(detail.examId || '');
      if (
        !expected.has(examId) ||
        detailsByExamId.has(examId) ||
        normalizeRutBody(detail.rutBody) !== expectedRut ||
        cleanText(detail.error) ||
        !Array.isArray(detail.findings)
      ) return null;
      detailsByExamId.set(examId, detail);
    }
    return examIds.every(examId => detailsByExamId.has(examId))
      ? examIds.map(examId => detailsByExamId.get(examId))
      : null;
  };
  const analysisSort = (a, b) => {
    const indexA = IMPORTANT_ANALYSES.indexOf(a);
    const indexB = IMPORTANT_ANALYSES.indexOf(b);
    if (indexA !== -1 || indexB !== -1) {
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    }
    return a.localeCompare(b, 'es');
  };
  const sanitizeFinding = value => {
    if (!value || typeof value !== 'object') return null;
    const section = cleanText(value.section) || 'GENERAL';
    const analysis = normalizeAnalysisName(value.analysis, section);
    const result = cleanText(value.result);
    if (!analysis || !result) return null;
    const finding = {
      section,
      analysis,
      result,
      unit: cleanText(value.unit),
      refValue: cleanText(value.refValue),
      qualitative: Boolean(value.qualitative),
    };
    finding.alert = findingAlert(finding);
    return finding;
  };
  const buildAnalysis = (details, exams) => {
    const safeExams = sanitizeExamList(exams);
    const examById = new Map(safeExams.map(exam => [exam.id, exam]));
    const reports = [];
    for (const detail of Array.isArray(details) ? details : []) {
      if (!detail) continue;
      const exam = examById.get(String(detail.examId || ''));
      if (!exam) continue;
      const findings = (Array.isArray(detail.findings) ? detail.findings : [])
        .map(sanitizeFinding).filter(Boolean).slice(0, 500);
      reports.push({
        examId: exam.id,
        date: exam.date,
        time: exam.time,
        label: `${exam.date}${exam.time ? ' ' + exam.time : ''}`,
        timestamp: parseDate(exam.date, exam.time),
        examNames: exam.exams,
        findings,
        error: cleanText(detail.error),
      });
    }
    reports.sort((a, b) => a.timestamp - b.timestamp);

    const columns = reports.map(report => ({
      key: report.examId,
      label: report.label,
      examNames: report.examNames,
      error: report.error,
    }));
    const rowsByName = new Map();
    for (const report of reports) {
      for (const finding of report.findings) {
        const rowKey = [finding.section, finding.analysis, finding.unit].map(comparisonToken).join('|');
        if (!rowsByName.has(rowKey)) {
          rowsByName.set(rowKey, {
            key: rowKey,
            analysis: finding.analysis,
            section: finding.section,
            unit: finding.unit,
            values: {},
          });
        }
        rowsByName.get(rowKey).values[report.examId] = finding;
      }
    }
    const comparison = [...rowsByName.values()].sort((a, b) => analysisSort(a.analysis, b.analysis));
    const trends = comparison.map(row => ({
      analysis: row.analysis,
      unit: row.unit,
      points: reports.map(report => {
        const finding = row.values[report.examId];
        if (!finding || !isSystemicTrendEligible(finding)) return null;
        const measurement = parseMeasurement(finding.result, finding);
        if (!measurement || measurement.comparator !== '=') return null;
        return {
          examId: report.examId,
          label: report.label,
          timestamp: report.timestamp,
          value: measurement.value,
          alert: finding.alert,
        };
      }).filter(Boolean),
    })).filter(trend => trend.points.length >= 2).slice(0, 24);

    return {
      columns,
      comparison,
      trends,
      reports: reports.slice().reverse(),
      summary: {
        reportCount: reports.length,
        findingCount: reports.reduce((total, report) => total + report.findings.length, 0),
        alertCount: reports.reduce(
          (total, report) => total + report.findings.filter(finding => finding.alert).length,
          0
        ),
      },
    };
  };

  const comparisonClipboard = analysis => {
    if (!analysis || !Array.isArray(analysis.columns)) return '';
    const lines = [['Variable', ...analysis.columns.map(column => column.label)].join('\t')];
    for (const row of Array.isArray(analysis.comparison) ? analysis.comparison : []) {
      lines.push([
        [row.analysis, row.section, row.unit].filter(Boolean).join(' · '),
        ...analysis.columns.map(column => {
          const finding = row.values && row.values[column.key];
          return finding ? `${finding.result}${finding.unit ? ' ' + finding.unit : ''}` : '--';
        }),
      ].join('\t'));
    }
    return lines.join('\n');
  };

  return {
    buildAnalysis,
    comparisonClipboard,
    examRowsMatchRut,
    findingAlert,
    extractRutBodyFromReportText,
    normalizeAnalysisName,
    normalizePatientRutBody,
    normalizeRutBody,
    parseReportText,
    sanitizeExamList,
    validateDetailBatch,
  };
});
