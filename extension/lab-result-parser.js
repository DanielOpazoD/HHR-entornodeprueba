/**
 * Context-aware parser for Syslab PDF findings.
 * Keeps specimen classification and localized numeric parsing outside the viewer runtime.
 */
(function (root, factory) {
  const api = factory();
  root.HhrLabResultParser = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  const cleanText = value => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const comparisonToken = value => cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const isUrineSection = section => /orina|urinari|sedimento|albuminuria|creatininuria|creatinuria|proteinuria/i
    .test(comparisonToken(section));
  const isOtherFluidSection = section => /\bliquido\b|\blcr\b/i.test(comparisonToken(section));
  const specimenSignature = finding => `${finding && finding.section || ''} ${finding && finding.analysis || ''} ${finding && finding.unit || ''}`;
  const isSystemicTrendEligible = finding => {
    if (finding && (finding.analysis === 'RAC' || finding.analysis === 'RPC')) return true;
    return !isUrineSection(specimenSignature(finding)) && !isOtherFluidSection(specimenSignature(finding));
  };
  const normalizeAnalysisName = (value, section) => {
    const name = cleanText(value);
    const token = comparisonToken(name);
    const hasRatioLabel = token === 'rac' || token === 'rpc' || token.includes('relac') || token.includes('ratio');
    if (hasRatioLabel && token.includes('albumina') && token.includes('creatininuri')) return 'RAC';
    if (hasRatioLabel && token.includes('proteinuria') && token.includes('creatininuri')) return 'RPC';
    if (isUrineSection(section) && /^leucocitos$/i.test(name)) return 'Leucocitos';

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
    for (const [pattern, replacement] of replacements) {
      if (pattern.test(name)) return replacement;
    }
    return name;
  };

  const referenceDeclaresDecimals = reference => {
    const value = cleanText(reference);
    return /\d+,\d+/.test(value) || /\d+\.\d{1,2}(?!\d)/.test(value) || /\b0\.\d{3,}\b/.test(value);
  };
  const usesScaledCellUnit = unit => /(?:X|×)?10\s*\^?\s*[369]/i.test(cleanText(unit));
  const usesWholeNumberUnit = unit => /^(?:(?:U|UI|IU)\/?L|(?:(?:C[ÉE]L(?:ULA)?S?|CELLS?)\/?)?\/?(?:[UµΜ]L|MM(?:\^?3|³)))$/i.test(cleanText(unit).replace(/[\s|]/g, ''));
  const LOCALIZED_NUMBER_SOURCE = '[+-]?\\d[\\d.,]*';
  const REFERENCE_RANGE_REGEX = new RegExp(`(${LOCALIZED_NUMBER_SOURCE})\\s*[-–]\\s*(${LOCALIZED_NUMBER_SOURCE})`);
  const REFERENCE_BOUND_REGEX = new RegExp(`^\\s*([<>]=?|[≤≥])\\s*(${LOCALIZED_NUMBER_SOURCE})`);
  const REFERENCE_SUFFIX_REGEX = new RegExp(
    `(?:^|\\s)((?:(?:[<>]=?|[≤≥])\\s*)?${LOCALIZED_NUMBER_SOURCE}\\s*[-–]\\s*${LOCALIZED_NUMBER_SOURCE}|(?:[<>]=?|[≤≥])\\s*${LOCALIZED_NUMBER_SOURCE})\\s*$`
  );
  const parseMeasurement = (value, context) => {
    const compact = cleanText(value).replace(/\s/g, '');
    const match = compact.match(/^([<>]=?|[≤≥])?([+-]?\d[\d.,]*)$/);
    if (!match) return null;
    const numeric = match[2];
    const unsignedNumeric = numeric.replace(/^[+-]/, '');
    const unit = cleanText(context && context.unit);
    const refValue = cleanText(context && context.refValue);
    let normalized = numeric;

    if (numeric.includes(',') && numeric.includes('.')) {
      normalized = numeric.lastIndexOf(',') > numeric.lastIndexOf('.')
        ? numeric.replace(/\./g, '').replace(',', '.')
        : numeric.replace(/,/g, '');
    } else if (numeric.includes(',')) {
      normalized = numeric.replace(',', '.');
    } else if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(unsignedNumeric)) {
      normalized = numeric.replace(/\./g, '');
    } else if (
      /^\d{1,3}\.\d{3}$/.test(unsignedNumeric) &&
      !unsignedNumeric.startsWith('0.') &&
      !usesScaledCellUnit(unit) &&
      !referenceDeclaresDecimals(refValue) &&
      usesWholeNumberUnit(unit)
    ) {
      normalized = numeric.replace('.', '');
    }

    const number = Number(normalized);
    if (!Number.isFinite(number)) return null;
    const rawComparator = match[1] || '=';
    const comparator = rawComparator === '≤' ? '<=' : rawComparator === '≥' ? '>=' : rawComparator;
    return { comparator, value: number };
  };

  const parseReferenceNumber = (value, context) => parseMeasurement(value, context)?.value;

  const referenceBounds = (value, context) => {
    const ref = cleanText(value);
    let match = ref.match(REFERENCE_RANGE_REGEX);
    if (match) {
      const min = parseReferenceNumber(match[1], context);
      const max = parseReferenceNumber(match[2], context);
      return min != null && max != null
        ? { min, max, minInclusive: true, maxInclusive: true }
        : null;
    }
    match = ref.match(REFERENCE_BOUND_REGEX);
    if (!match) return null;
    const boundary = parseReferenceNumber(match[2], context);
    if (boundary == null) return null;
    if (match[1].startsWith('<') || match[1] === '≤') {
      return {
        min: null,
        max: boundary,
        minInclusive: true,
        maxInclusive: match[1] === '<=' || match[1] === '≤',
      };
    }
    return {
      min: boundary,
      max: null,
      maxInclusive: true,
      minInclusive: match[1] === '>=' || match[1] === '≥',
    };
  };

  const findingAlert = finding => {
    const result = cleanText(finding && finding.result);
    const measurement = parseMeasurement(result, finding);
    const bounds = referenceBounds(finding && finding.refValue, finding);
    if (measurement && measurement.comparator === '=' && bounds) {
      if (bounds.min != null && (measurement.value < bounds.min || (!bounds.minInclusive && measurement.value === bounds.min))) return true;
      if (bounds.max != null && (measurement.value > bounds.max || (!bounds.maxInclusive && measurement.value === bounds.max))) return true;
      return false;
    }
    if (measurement && bounds) {
      const isLess = measurement.comparator === '<';
      const isLessOrEqual = measurement.comparator === '<=';
      const isGreater = measurement.comparator === '>';
      const isGreaterOrEqual = measurement.comparator === '>=';
      if (bounds.min != null && (
        (isLess && measurement.value <= bounds.min) ||
        (isLessOrEqual && (measurement.value < bounds.min || (measurement.value === bounds.min && !bounds.minInclusive)))
      )) return true;
      if (bounds.max != null && (
        (isGreater && measurement.value >= bounds.max) ||
        (isGreaterOrEqual && (measurement.value > bounds.max || (measurement.value === bounds.max && !bounds.maxInclusive)))
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

  const REPORT_SKIP_PATTERNS = [
    /^HOSPITAL\s+DE\s+/i, /^Laboratorio\s+Cl[íi]nico/i, /^Nombre\s*:/i,
    /^Rut\/?Fic\s*:/i, /^Fecha\s+de\s+Nac/i, /^Procedencia\s*:/i,
    /^Fecha\s+y\s+Hora/i, /^Fecha\s+de\s+impresi[óo]n/i,
    /^E\s+X\s+A\s+M\s+E\s+N\s+E\s+S\s*$/, /^Director\s+T[ée]cnico/i,
    /^Resultado\s+Via\s+WEB/i, /^Resultado\s+Unidad\s+Valor\s+de\s+Referencia/i,
    /^Nota\s*:/i, /^Valores?\s+(de\s+)?[Rr]eferencia/i, /^Ni[ñn]os?.*\s\d/i,
    /^Adultos\s+[<>]/i, /^Para\s+valores/i, /^se\s+recomienda/i, /^_+$/, /^TM\s+[A-ZÁÉÍÓÚÑ]/,
  ];
  const REPORT_SECTION_REGEX = /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9\s\+\-\/\#\.]{2,60}$/;
  const REPORT_NUMERIC_REGEX = /^(.+?)\s*:\s*\|?\s*((?:[<>]=?|[≤≥])?\s*[+-]?\s*[\d.,]+)(.*)$/;
  const REPORT_QUALITATIVE_REGEX = /^(.+?)\s*:\s*(NEGATIVO|POSITIVO|NORMAL|AUSENTE|PRESENTE|REACTIVO|NO\s+REACTIVO|DETECTADO|NO\s+DETECTADO|ESCASA|MODERADA|ABUNDANTE|NO\s+SE\s+OBSERVA(?:N)?)\s*$/i;
  const REPORT_NON_ANALYTIC_PATTERNS = [
    /^Edad$/i, /^Valor\s+de\s+referencia$/i, /^Profilaxis\s+trombosis\s+venosa$/i,
    /^Prevenci[oó]n\s+tromb\./i, /^Profilaxis\s+arteriales/i, /^Equipo\s+analizador$/i,
    /^Hombres?$/i, /^Mujeres/i, /^Ni[ñn]os?/i, /^Ni[ñn]as?/i, /^Adultos?/i,
    /^Embarazadas?/i, /^Reci[ée]n\s+nacidos?/i, /^Lactantes?/i,
  ];

  const extractRutBodyFromReportText = text => {
    const line = String(text || '').split(/\r?\n/).find(value => /^\s*Rut\/?Fic\s*:/i.test(value));
    if (!line) return '';
    const match = line.replace(/^\s*Rut\/?Fic\s*:/i, '').match(/\d[\d.]*/);
    return match ? match[0].replace(/\D/g, '') : '';
  };

  const splitReportUnitAndReference = rest => {
    const cleaned = String(rest || '').replace(/^\s*\|+\s*|\s*\|+\s*$/g, '').trim();
    if (!cleaned) return { unit: '', refValue: '' };
    const rangeSuffix = cleaned.match(REFERENCE_SUFFIX_REGEX);
    if (rangeSuffix && Number.isInteger(rangeSuffix.index)) {
      return {
        unit: cleaned.slice(0, rangeSuffix.index).trim(),
        refValue: rangeSuffix[1].trim(),
      };
    }
    return { unit: cleaned, refValue: '' };
  };

  const isValidAnalysis = analysis => analysis.length >= 2 && analysis.length <= 60 &&
    !analysis.includes(':') && !REPORT_NON_ANALYTIC_PATTERNS.some(pattern => pattern.test(analysis));

  const parseReportText = text => {
    const parsedData = [];
    let currentSection = 'GENERAL';
    for (let line of String(text || '').split(/\r?\n/)) {
      line = line.trim();
      if (line.length < 3 || REPORT_SKIP_PATTERNS.some(pattern => pattern.test(line))) continue;
      if (!line.includes(':') && REPORT_SECTION_REGEX.test(line)) {
        currentSection = cleanText(line);
        continue;
      }
      let match = line.match(REPORT_QUALITATIVE_REGEX);
      if (match) {
        const analysis = normalizeAnalysisName(match[1], currentSection);
        if (!isValidAnalysis(analysis)) continue;
        parsedData.push({ section: currentSection, analysis, result: match[2].trim().toUpperCase(), unit: '', refValue: '', qualitative: true });
        continue;
      }
      match = line.match(REPORT_NUMERIC_REGEX);
      if (!match) continue;
      const analysis = normalizeAnalysisName(match[1], currentSection);
      if (!isValidAnalysis(analysis)) continue;
      const split = splitReportUnitAndReference(match[3]);
      parsedData.push({ section: currentSection, analysis, result: match[2].replace(/\s+/g, ''), unit: split.unit, refValue: split.refValue });
    }
    return parsedData;
  };

  return {
    comparisonToken,
    extractRutBodyFromReportText,
    findingAlert,
    isSystemicTrendEligible,
    normalizeAnalysisName,
    parseMeasurement,
    parseReportText,
  };
});
