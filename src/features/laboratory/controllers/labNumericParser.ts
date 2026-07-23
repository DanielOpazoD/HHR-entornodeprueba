import type { LabResultRow } from '@/types/domain/labExamTypes';

export type LabNumberFormat = 'integer' | 'decimal-comma' | 'decimal-dot' | 'grouped-thousands';

export interface ParsedLabMeasurement {
  comparator: '=' | '<' | '<=' | '>' | '>=';
  value: number;
  format: LabNumberFormat;
}

const normalizeComparator = (value: string): ParsedLabMeasurement['comparator'] => {
  if (value === '≤') return '<=';
  if (value === '≥') return '>=';
  return (value || '=') as ParsedLabMeasurement['comparator'];
};

const usesScaledCellUnit = (unit: string): boolean => /(?:X|×)?10\s*\^?\s*[369]/i.test(unit);

const referenceDeclaresDecimals = (reference: string): boolean =>
  /\d+,\d+/.test(reference) ||
  /\d+\.\d{1,2}(?!\d)/.test(reference) ||
  /\b0\.\d{3,}\b/.test(reference);

const usesWholeNumberUnit = (unit: string): boolean =>
  /^(?:U|UI|IU)\/?L$/i.test(unit.replace(/[\s|]/g, ''));

const shouldTreatSingleDotAsThousands = (
  numeric: string,
  context: Pick<LabResultRow, 'unit' | 'refValue'>
): boolean => {
  if (!/^\d{1,3}\.\d{3}$/.test(numeric)) return false;
  if (numeric.startsWith('0.')) return false;
  if (usesScaledCellUnit(context.unit)) return false;
  if (referenceDeclaresDecimals(context.refValue)) return false;
  return usesWholeNumberUnit(context.unit);
};

/**
 * Parses a Syslab measurement using its unit and reference range to resolve `1.071`.
 * Syslab uses comma decimals, while a dot followed by three digits in whole-number
 * units (for example U/L) is a thousands separator. Scaled cell units keep the dot
 * as a decimal marker.
 */
export const parseLabMeasurement = (
  rawValue: string,
  context: Pick<LabResultRow, 'unit' | 'refValue'>
): ParsedLabMeasurement | null => {
  const compact = String(rawValue || '').replace(/\s+/g, '');
  const match = compact.match(/^([<>]=?|[≤≥])?([+-]?\d[\d.,]*)$/);
  if (!match) return null;

  const numeric = match[2];
  const unsignedNumeric = numeric.replace(/^[+-]/, '');
  let normalized = numeric;
  let format: LabNumberFormat = 'integer';

  if (numeric.includes(',') && numeric.includes('.')) {
    const commaIsDecimal = numeric.lastIndexOf(',') > numeric.lastIndexOf('.');
    normalized = commaIsDecimal
      ? numeric.replace(/\./g, '').replace(',', '.')
      : numeric.replace(/,/g, '');
    format = commaIsDecimal ? 'decimal-comma' : 'decimal-dot';
  } else if (numeric.includes(',')) {
    normalized = numeric.replace(',', '.');
    format = 'decimal-comma';
  } else if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(unsignedNumeric)) {
    normalized = numeric.replace(/\./g, '');
    format = 'grouped-thousands';
  } else if (numeric.includes('.')) {
    if (shouldTreatSingleDotAsThousands(unsignedNumeric, context)) {
      normalized = numeric.replace('.', '');
      format = 'grouped-thousands';
    } else {
      format = 'decimal-dot';
    }
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return { comparator: normalizeComparator(match[1]), value, format };
};
