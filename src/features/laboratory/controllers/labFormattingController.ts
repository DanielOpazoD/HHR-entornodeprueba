/**
 * @module labFormattingController
 * @description Pure formatting and parsing functions for laboratory data.
 * No React dependency — can be used in any context (hooks, services, tests).
 */

import type { LabResultRow } from '@/types/domain/labExamTypes';
import { parseLabMeasurement } from './labNumericParser';

const ANALYSIS_NAME_REPLACEMENTS: [RegExp, string][] = [
  [/HCO3\s*ACTUAL/i, 'HCO3'],
  [/Hb\.\s*Corp\.\s*Media\s*-\s*HCM/i, 'HCM'],
  [/Vol\.\s*Corp\.\s*Medio\s*VCM/i, 'VCM'],
  [/^\s*Leucocitos(?:\s+totales)?\s*$/i, 'Recuento Leucocitos'],
  [/^\s*Rcto\.?\s*Leucocitos\s*$/i, 'Recuento Leucocitos'],
  [/^\s*Plaquetas\s*$/i, 'Recuento de Plaquetas'],
  [/^\s*Neutr[oó]filos(?:\s+segmentados)?\s*$/i, 'Segmentados'],
  [/^\s*Creatinina(?:\s+s[eé]rica)?\s*$/i, 'Creatinina'],
  [/^\s*PCR\s*$/i, 'Proteina C Reactiva'],
  [/^\s*Prot\.?\s*C\.?\s*Reactiva\s*$/i, 'Proteina C Reactiva'],
  [/^\s*(?:CK|CPK|Creatin(?:a\s+)?(?:fosfo)?(?:quinasa|kinasa))(?:\s+Total)?\s*$/i, 'CK Total'],
  [/^\s*Hemoglobina\s+Glicosilada(?:\s*#?\d*)?\s*$/i, 'Hb glicosilada'],
  [/^\s*Triglic(?:#|e|é)ridos\s*$/i, 'Trigliceridos'],
  [/^\s*(?:Rel(?:aci[oó]n|ac\.?|\.?)\s*)?Proteinuria\s*\/\s*Creatininuria\s*[:=]?\s*$/i, 'RPC'],
  [
    /^\s*(?:Rel(?:aci[oó]n|ac\.?|\.?)\s*)?Albumina\s*\/\s*Creatin(?:in)?uri[a]?\s*[:=]?\s*$/i,
    'RAC',
  ],
  [/^\s*Bilirrubina\s+T\.?\s*$/i, 'Bilirrubina Total'],
  [/^\s*Bilirrubina\s+D\.?\s*$/i, 'Bilirrubina Directa'],
  [/^\s*Bilirrubina\s+I\.?\s*$/i, 'Bilirrubina Indirecta'],
];

/**
 * Parse a localized number string (using comma as decimal separator) to a float.
 * @example parseLocalizedNumber("14,5") // 14.5
 * @example parseLocalizedNumber("7.280") // 7.28
 * @example parseLocalizedNumber("abc") // NaN
 */
export const parseLocalizedNumber = (str: string): number => parseFloat(str.replace(',', '.'));

/**
 * Parse a scientific notation unit (x10^N) and multiply the value.
 * @returns The multiplied integer and clean unit suffix, or null if not scientific.
 * @example parseScientificValue("879", "x10^3/ul") // { multiplied: 879000, unitSuffix: "ul" }
 */
export const parseScientificValue = (
  result: string,
  unit: string
): { multiplied: number; unitSuffix: string } | null => {
  const [, exponentRaw, suffixRaw] = unit.match(/x10\^(\d+)(.*)/) ?? [];
  if (!exponentRaw) return null;
  const exponent = parseInt(exponentRaw, 10);
  const unitSuffix = suffixRaw?.replace(/^\//, '') || '';
  const num = parseLocalizedNumber(result);
  if (isNaN(num)) return null;
  return { multiplied: Math.round(num * Math.pow(10, exponent)), unitSuffix };
};

/**
 * Parse a reference range string into numeric min/max bounds.
 * @example parseRefRange("12.0-16.0") // { min: 12, max: 16 }
 * @example parseRefRange("4,5 - 11,0") // { min: 4.5, max: 11 }
 * @example parseRefRange("Negativo") // null
 */
export const parseRefRange = (
  refValue: string,
  context?: Pick<LabResultRow, 'unit'>
): { min: number; max: number } | null => {
  const [, minRaw, maxRaw] = refValue.match(/([\d.,]+)\s*[-–]\s*([\d.,]+)/) ?? [];
  if (!minRaw || !maxRaw) return null;
  const measurementContext = context ? { unit: context.unit, refValue } : null;
  const min = measurementContext
    ? parseLabMeasurement(minRaw, measurementContext)?.value
    : parseLocalizedNumber(minRaw);
  const max = measurementContext
    ? parseLabMeasurement(maxRaw, measurementContext)?.value
    : parseLocalizedNumber(maxRaw);
  if (min == null || max == null) return null;
  if (isNaN(min) || isNaN(max)) return null;
  return { min, max };
};

/**
 * Convert DD/MM/YYYY date string to ISO YYYY-MM-DD for sorting.
 * @example parseDateDDMMYYYY("06/04/2026") // "2026-04-06"
 */
export const parseDateDDMMYYYY = (date: string): string => {
  const [, day, month, year] = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/) ?? [];
  if (!day || !month || !year) return date;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

/**
 * Check if a result value is outside the reference range.
 * @returns `true` if out of range, `false` if within range, `null` if unparseable.
 */
export const isOutOfRange = (
  result: string,
  refValue: string,
  context?: Pick<LabResultRow, 'unit'>
): boolean | null => {
  const range = parseRefRange(refValue, context);
  if (!range) return null;
  const value = context
    ? parseLabMeasurement(result, { unit: context.unit, refValue })?.value
    : parseLocalizedNumber(result);
  if (value == null || isNaN(value)) return null;
  return value < range.min || value > range.max;
};

/**
 * Normalize analysis variable names for consistent display.
 * @example normalizeAnalysisName("HCO3 ACTUAL") // "HCO3"
 * @example normalizeAnalysisName("Vol. Corp. Medio VCM") // "VCM"
 */
const isUrineSection = (section: string | undefined): boolean => {
  const upper = String(section || '').toUpperCase();
  return (
    upper.includes('ORINA') ||
    upper.includes('SEDIMENTO') ||
    upper.includes('QUIMICA/ORINA') ||
    upper.includes('FISICO-QUIMICO')
  );
};

const collapseClinicalToken = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

const normalizeUrineRatioName = (name: string, section?: string): string | null => {
  const nameToken = collapseClinicalToken(name);
  const sectionToken = collapseClinicalToken(section || '');
  const hasCreatinineRatioToken =
    nameToken.includes('CREATININURIA') ||
    nameToken.includes('CREATININURI') ||
    nameToken.includes('CREATINURIA');
  const canInferRatioFromSection =
    nameToken.length === 0 || nameToken.includes('RELAC') || nameToken.includes('RELACION');

  if (
    ((nameToken.includes('PROTEINURIA') && hasCreatinineRatioToken) ||
      (canInferRatioFromSection && sectionToken.includes('PROTEINURIA'))) &&
    (hasCreatinineRatioToken || canInferRatioFromSection)
  ) {
    return 'RPC';
  }

  if (
    (((nameToken.includes('ALBUMINA') || nameToken.includes('ALBUMINURIA')) &&
      hasCreatinineRatioToken) ||
      (canInferRatioFromSection &&
        (sectionToken.includes('ALBUMINA') || sectionToken.includes('ALBUMINURIA')))) &&
    (hasCreatinineRatioToken || canInferRatioFromSection)
  ) {
    return 'RAC';
  }

  return null;
};

const normalizeUrineAnalysisName = (name: string): string | null => {
  const collapsed = name.trim().replace(/\s+/g, ' ');
  const replacements: Array<[RegExp, string]> = [
    [/^\s*Leucocitos\s*$/i, 'Leucocitos'],
    [/^\s*Eritrocitos\s*$/i, 'Eritrocitos'],
    [/^\s*Bacterias\s*$/i, 'Bacterias'],
    [/^\s*Cilindros\s*$/i, 'Cilindros'],
    [/^\s*Placas de pus\s*$/i, 'Placas de pus'],
    [/^\s*Cuerpos\s+Cet[oó]nicos\s*$/i, 'Cuerpos Cetónicos'],
    [/^\s*Proteinas\s*$/i, 'Proteínas'],
    [/^\s*Nitritos\s*$/i, 'Nitritos'],
    [/^\s*pH\s*$/i, 'pH'],
    [/^\s*Densidad\s*$/i, 'Densidad'],
    [/^\s*Creatininuria\s*$/i, 'Creatininuria'],
    [/^\s*Proteinuria\s*$/i, 'Proteinuria'],
    [/^\s*Microalbuminuria\s*$/i, 'Microalbuminuria'],
  ];

  for (const [pattern, replacement] of replacements) {
    if (pattern.test(collapsed)) {
      return replacement;
    }
  }

  return null;
};

export const normalizeAnalysisName = (name: string, section?: string): string => {
  let result = name.trim().replace(/\s+/g, ' ');
  const urineRatioName = normalizeUrineRatioName(result, section);

  if (urineRatioName) {
    return urineRatioName;
  }

  if (isUrineSection(section)) {
    const urineSpecific = normalizeUrineAnalysisName(result);
    if (urineSpecific) {
      return urineSpecific;
    }
  }

  for (const [pattern, replacement] of ANALYSIS_NAME_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
};

/**
 * Format a lab result for display. Handles x10^3 / x10^6 unit conversions.
 * @example formatLabResult("879", "x10^3/ul") // { display: "879.000", displayUnit: "/ul" }
 * @example formatLabResult("14,5", "g/dL") // { display: "14,5", displayUnit: "g/dL" }
 */
export const formatLabResult = (
  result: string,
  unit: string
): { display: string; displayUnit: string } => {
  const sci = parseScientificValue(result, unit);
  if (sci) {
    const formatted = sci.multiplied.toLocaleString('es-CL');
    return { display: formatted, displayUnit: sci.unitSuffix ? `/${sci.unitSuffix}` : '' };
  }
  return { display: result, displayUnit: unit };
};

/**
 * Bed sort order: R1-R4 (0-3), Neo1-Neo2 (4-5), H1C1-H6C2 (10-21).
 */
export const bedSortKey = (bedId: string): number => {
  const upper = bedId.toUpperCase().replace(/\s+/g, '');
  const rBed = upper.match(/^R(\d+)$/)?.[1];
  if (rBed) return parseInt(rBed, 10);
  const neoBed = upper.match(/^NEO(\d+)$/)?.[1];
  if (neoBed) return 4 + parseInt(neoBed, 10);
  const [, hRoom, hBed] = upper.match(/^H(\d+)C(\d+)$/) ?? [];
  if (hRoom && hBed) return 10 + (parseInt(hRoom, 10) - 1) * 2 + (parseInt(hBed, 10) - 1);
  return 100;
};

/** Remove PDF column separators, preserving the clinical unit and its scale. */
export const normalizeLabUnit = (unit: string): string =>
  unit.replace(/^[\s|]+|[\s|]+$/g, '').trim();

export const formatLabExamColumnLabel = (examDate: string, includeTimeInColumns = true): string => {
  if (includeTimeInColumns) {
    return examDate;
  }

  const dateOnlyMatch = examDate.match(/^(\d{2}\/\d{2}\/\d{4})(?:\s+\d{2}:\d{2})?$/);
  return dateOnlyMatch?.[1] ?? examDate;
};
