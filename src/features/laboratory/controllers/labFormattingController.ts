/**
 * @module labFormattingController
 * @description Pure formatting and parsing functions for laboratory data.
 * No React dependency — can be used in any context (hooks, services, tests).
 */

import { ANALYSIS_NAME_REPLACEMENTS } from '../constants/labNormalizationConstants';
import type { LabResultRow } from '@/types/domain/labExamTypes';
import { parseLabMeasurement } from './labNumericParser';

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
  const match = unit.match(/x10\^(\d+)(.*)/);
  if (!match) return null;
  const exponent = parseInt(match[1], 10);
  const unitSuffix = match[2]?.replace(/^\//, '') || '';
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
  const match = refValue.match(/([\d.,]+)\s*[-–]\s*([\d.,]+)/);
  if (!match) return null;
  const measurementContext = context ? { unit: context.unit, refValue } : null;
  const min = measurementContext
    ? parseLabMeasurement(match[1], measurementContext)?.value
    : parseLocalizedNumber(match[1]);
  const max = measurementContext
    ? parseLabMeasurement(match[2], measurementContext)?.value
    : parseLocalizedNumber(match[2]);
  if (min == null || max == null) return null;
  if (isNaN(min) || isNaN(max)) return null;
  return { min, max };
};

/**
 * Convert DD/MM/YYYY date string to ISO YYYY-MM-DD for sorting.
 * @example parseDateDDMMYYYY("06/04/2026") // "2026-04-06"
 */
export const parseDateDDMMYYYY = (date: string): string => {
  const match = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return date;
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
};

/**
 * Check if a result value is outside the reference range.
 * @returns `true` if out of range, `false` if within range, `null` if unparseable.
 */
export const isOutOfRange = (result: string, refValue: string): boolean | null => {
  const range = parseRefRange(refValue);
  if (!range) return null;
  const val = parseLocalizedNumber(result);
  if (isNaN(val)) return null;
  return val < range.min || val > range.max;
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
  const rMatch = upper.match(/^R(\d+)$/);
  if (rMatch) return parseInt(rMatch[1], 10);
  const neoMatch = upper.match(/^NEO(\d+)$/);
  if (neoMatch) return 4 + parseInt(neoMatch[1], 10);
  const hMatch = upper.match(/^H(\d+)C(\d+)$/);
  if (hMatch) return 10 + (parseInt(hMatch[1], 10) - 1) * 2 + (parseInt(hMatch[2], 10) - 1);
  return 100;
};
