/**
 * Pure contracts and analytics for the native Eloisa laboratory viewer.
 * UMD keeps the same implementation available to the MV3 worker, content script and Vitest.
 */
(function (root, factory) {
  const api = factory();
  root.HhrLabViewer = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';
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
  const comparisonToken = value => cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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
  const normalizeAnalysisName = (value, section) => {
    let name = cleanText(value);
    const token = comparisonToken(name);
    const hasRatioLabel = token === 'rac' || token === 'rpc' || token.includes('relac') || token.includes('ratio');
    if (hasRatioLabel && token.includes('albumina') && token.includes('creatininuri')) return 'RAC';
    if (hasRatioLabel && token.includes('proteinuria') && token.includes('creatininuri')) return 'RPC';

    const replacements = [
      [/^leucocitos$/i, 'Recuento Leucocitos'],
      [/^recuento\s+de?\s*leucocitos$/i, 'Recuento Leucocitos'],
      [/^plaquetas$|^recuento\s+(?:de\s+)?plaquetas$/i, 'Recuento de Plaquetas'],
      [/^prote[ií]na\s+c\s+reactiva$|^pcr\s+cuantitativ[ao]$/i, 'Proteina C Reactiva'],
      [/^nitr[oó]geno\s+ureico$/i, 'Nitrogeno Ureico'],
      [/^hco3(?:\s+actual)?$/i, 'HCO3'],
      [/^t4\s+libre$/i, 'T4L'],
      [/^triglic[eé]ridos$/i, 'TG'],
      [/^hemoglobina\s+glicosilada$/i, 'Hb glicosilada'],
    ];
    for (const pair of replacements) {
      if (pair[0].test(name)) return pair[1];
    }
    return name;
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
  const parseMeasurement = value => {
    const normalized = cleanText(value).replace(/\s/g, '').replace(',', '.');
    const match = normalized.match(/^([<>]=?|[≤≥])?([-+]?\d+(?:\.\d+)?)$/);
    if (!match) return null;
    return { comparator: match[1] || '=', value: Number(match[2]) };
  };
  const referenceBounds = value => {
    const ref = cleanText(value).replace(/,/g, '.');
    let match = ref.match(/(-?\d+(?:\.\d+)?)\s*[-–]\s*(-?\d+(?:\.\d+)?)/);
    if (match) {
      return {
        min: Number(match[1]), max: Number(match[2]),
        minInclusive: true, maxInclusive: true,
      };
    }
    match = ref.match(/^\s*([<>]=?|[≤≥])\s*(-?\d+(?:\.\d+)?)/);
    if (!match) return null;
    if (match[1].startsWith('<') || match[1] === '≤') {
      return {
        min: null, max: Number(match[2]), minInclusive: true,
        maxInclusive: match[1] === '<=' || match[1] === '≤',
      };
    }
    return {
      min: Number(match[2]), max: null, maxInclusive: true,
      minInclusive: match[1] === '>=' || match[1] === '≥',
    };
  };
  const findingAlert = finding => {
    const result = cleanText(finding && finding.result);
    const measurement = parseMeasurement(result);
    const bounds = referenceBounds(finding && finding.refValue);
    if (measurement && measurement.comparator === '=' && bounds) {
      if (bounds.min != null && (
        measurement.value < bounds.min ||
        (!bounds.minInclusive && measurement.value === bounds.min)
      )) return true;
      if (bounds.max != null && (
        measurement.value > bounds.max ||
        (!bounds.maxInclusive && measurement.value === bounds.max)
      )) return true;
      return false;
    }
    if (measurement && bounds) {
      const isLess = measurement.comparator === '<';
      const isLessOrEqual = measurement.comparator === '<=' || measurement.comparator === '≤';
      const isGreater = measurement.comparator === '>';
      const isGreaterOrEqual = measurement.comparator === '>=' || measurement.comparator === '≥';
      if (bounds.min != null && (
        (isLess && measurement.value <= bounds.min) ||
        (isLessOrEqual && (
          measurement.value < bounds.min ||
          (measurement.value === bounds.min && !bounds.minInclusive)
        ))
      )) return true;
      if (bounds.max != null && (
        (isGreater && measurement.value >= bounds.max) ||
        (isGreaterOrEqual && (
          measurement.value > bounds.max ||
          (measurement.value === bounds.max && !bounds.maxInclusive)
        ))
      )) return true;
    }
    const resultToken = comparisonToken(result);
    const referenceToken = comparisonToken(finding && finding.refValue);
    const qualitativeResult = /^(negativo|positivo|normal|ausente|presente|reactivo|no reactivo|detectado|no detectado|escasa|moderada|abundante|no se observa(?:n)?)$/;
    const qualitativeReference = /^(negativo|normal|ausente|no reactivo|no detectado|escasa|no se observa(?:n)?)$/;
    return qualitativeResult.test(resultToken) && qualitativeReference.test(referenceToken)
      ? resultToken !== referenceToken
      : false;
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
  const REPORT_SKIP_PATTERNS = [
    /^HOSPITAL\s+DE\s+/i,
    /^Laboratorio\s+Cl[íi]nico/i,
    /^Nombre\s*:/i,
    /^Rut\/?Fic\s*:/i,
    /^Fecha\s+de\s+Nac/i,
    /^Procedencia\s*:/i,
    /^Fecha\s+y\s+Hora/i,
    /^Fecha\s+de\s+impresi[óo]n/i,
    /^E\s+X\s+A\s+M\s+E\s+N\s+E\s+S\s*$/,
    /^Director\s+T[ée]cnico/i,
    /^Resultado\s+Via\s+WEB/i,
    /^Resultado\s+Unidad\s+Valor\s+de\s+Referencia/i,
    /^Nota\s*:/i,
    /^Valores?\s+(de\s+)?[Rr]eferencia/i,
    /^Ni[ñn]os?(\s*\/\s*Ni[ñn]as?)?\s+\d/i,
    /^Adultos\s+[<>]/i,
    /^Para\s+valores/i,
    /^se\s+recomienda/i,
    /^_+$/,
    /^TM\s+[A-ZÁÉÍÓÚÑ]/,
  ];
  const REPORT_SECTION_REGEX = /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9\s\+\-\/\#\.]{2,60}$/;
  const REPORT_NUMERIC_REGEX =
    /^(.+?)\s*:\s*\|?\s*((?:[<>]=?|[≤≥])?\s*[+-]?\s*[\d.,]+)(.*)$/;
  const REPORT_QUALITATIVE_REGEX =
    /^(.+?)\s*:\s*(NEGATIVO|POSITIVO|NORMAL|AUSENTE|PRESENTE|REACTIVO|NO\s+REACTIVO|DETECTADO|NO\s+DETECTADO|ESCASA|MODERADA|ABUNDANTE|NO\s+SE\s+OBSERVA(?:N)?)\s*$/i;
  const REPORT_NON_ANALYTIC_PATTERNS = [
    /^Edad$/i,
    /^Valor\s+de\s+referencia$/i,
    /^Profilaxis\s+trombosis\s+venosa$/i,
    /^Prevenci[oó]n\s+tromb\.\s+recidivante\s+y\s+tratamiento$/i,
    /^Profilaxis\s+arteriales\s+y\s+v[aá]lvulas\s+cardiacas$/i,
    /^Equipo\s+analizador$/i,
    /^Hombres?$/i,
    /^Mujeres(\s+.+)?$/i,
    /^Ni[ñn]os?(\s+.+)?$/i,
    /^Ni[ñn]as?(\s+.+)?$/i,
    /^Adultos?(\s+.+)?$/i,
    /^Embarazadas?(\s+.+)?$/i,
    /^Reci[ée]n\s+nacidos?(\s+.+)?$/i,
    /^Lactantes?(\s+.+)?$/i,
  ];
  const extractRutBodyFromReportText = text => {
    const line = String(text || '').split(/\r?\n/)
      .find(value => /^\s*Rut\/?Fic\s*:/i.test(value));
    if (!line) return '';
    const match = line.replace(/^\s*Rut\/?Fic\s*:/i, '').match(/\d[\d.]*/);
    return match ? match[0].replace(/\D/g, '') : '';
  };
  const splitReportUnitAndReference = rest => {
    const cleaned = String(rest || '').replace(/^\s*\|+\s*|\s*\|+\s*$/g, '').trim();
    if (!cleaned) return { unit: '', refValue: '' };
    const rangeSuffix = cleaned.match(
      /(?:^|\s)((?:(?:[<>]=?|[≤≥])\s*)?[+-]?\d+(?:[.,]\d+)?\s*[-–]\s*[+-]?\d+(?:[.,]\d+)?|(?:[<>]=?|[≤≥])\s*[+-]?\d+(?:[.,]\d+)?)\s*$/
    );
    if (rangeSuffix && Number.isInteger(rangeSuffix.index)) {
      const refValue = rangeSuffix[1].trim();
      const unit = cleaned.slice(0, rangeSuffix.index).trim();
      return { unit, refValue };
    }
    return {
      unit: cleaned,
      refValue: '',
    };
  };

  const parseReportText = text => {
    const parsedData = [];
    let currentSection = 'GENERAL';
    for (let line of String(text || '').split(/\r?\n/)) {
      line = line.trim();
      if (line.length < 3 || REPORT_SKIP_PATTERNS.some(pattern => pattern.test(line))) continue;
      if (!line.includes(':') && REPORT_SECTION_REGEX.test(line)) {
        currentSection = line.replace(/\s+/g, ' ').trim();
        continue;
      }
      let match = line.match(REPORT_QUALITATIVE_REGEX);
      if (match) {
        const analysis = normalizeAnalysisName(match[1].trim(), currentSection);
        if (
          analysis.length < 2 || analysis.length > 60 || analysis.includes(':') ||
          REPORT_NON_ANALYTIC_PATTERNS.some(pattern => pattern.test(analysis))
        ) continue;
        parsedData.push({
          section: currentSection,
          analysis,
          result: match[2].trim().toUpperCase(),
          unit: '',
          refValue: '',
          qualitative: true,
        });
        continue;
      }
      match = line.match(REPORT_NUMERIC_REGEX);
      if (!match) continue;
      const analysis = normalizeAnalysisName(match[1].trim(), currentSection);
      if (
        analysis.length < 2 || analysis.length > 60 || analysis.includes(':') ||
        REPORT_NON_ANALYTIC_PATTERNS.some(pattern => pattern.test(analysis))
      ) continue;
      const split = splitReportUnitAndReference(match[3]);
      parsedData.push({
        section: currentSection,
        analysis,
        result: match[2].replace(/\s+/g, ''),
        unit: split.unit,
        refValue: split.refValue,
      });
    }
    return parsedData;
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
        if (!finding) return null;
        const measurement = parseMeasurement(finding.result);
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
