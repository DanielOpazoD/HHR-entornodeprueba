/**
 * @fileoverview Unit tests for labFormattingController pure functions.
 */

import { describe, it, expect } from 'vitest';
import {
  parseRefRange,
  parseDateDDMMYYYY,
  isOutOfRange,
  normalizeAnalysisName,
  formatLabResult,
  bedSortKey,
} from '@/features/laboratory/controllers/labFormattingController';

/* ================================================================== */
/*  parseRefRange                                                      */
/* ================================================================== */

describe('parseRefRange', () => {
  it('parses "12.0-16.0"', () => {
    expect(parseRefRange('12.0-16.0')).toEqual({ min: 12, max: 16 });
  });

  it('parses comma-separated range "4,5 - 11,0"', () => {
    expect(parseRefRange('4,5 - 11,0')).toEqual({ min: 4.5, max: 11 });
  });

  it('parses dotted thousands with the same unscaled cell unit as the result', () => {
    expect(parseRefRange('4.000 - 11.000', { unit: '/uL' })).toEqual({
      min: 4000,
      max: 11000,
    });
  });

  it('keeps scaled cell reference ranges decimal', () => {
    expect(parseRefRange('4.000 - 11.000', { unit: 'x10^3/uL' })).toEqual({
      min: 4,
      max: 11,
    });
  });

  it('returns null for "< 6.0"', () => {
    expect(parseRefRange('< 6.0')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseRefRange('')).toBeNull();
  });

  it('returns null for "Negativo"', () => {
    expect(parseRefRange('Negativo')).toBeNull();
  });
});

/* ================================================================== */
/*  parseDateDDMMYYYY                                                  */
/* ================================================================== */

describe('parseDateDDMMYYYY', () => {
  it('converts "06/04/2026" to ISO', () => {
    expect(parseDateDDMMYYYY('06/04/2026')).toBe('2026-04-06');
  });

  it('pads single-digit day/month "1/3/2026"', () => {
    expect(parseDateDDMMYYYY('1/3/2026')).toBe('2026-03-01');
  });

  it('returns original for "invalid"', () => {
    expect(parseDateDDMMYYYY('invalid')).toBe('invalid');
  });

  it('returns original for empty string', () => {
    expect(parseDateDDMMYYYY('')).toBe('');
  });
});

/* ================================================================== */
/*  isOutOfRange                                                       */
/* ================================================================== */

describe('isOutOfRange', () => {
  it('returns true for value below range', () => {
    expect(isOutOfRange('3.0', '4.5-11.0')).toBe(true);
  });

  it('returns true for value above range', () => {
    expect(isOutOfRange('15.0', '4.5-11.0')).toBe(true);
  });

  it('returns false for value within range', () => {
    expect(isOutOfRange('7.5', '4.5-11.0')).toBe(false);
  });

  it('returns null for non-numeric result', () => {
    expect(isOutOfRange('Negativo', '4.5-11.0')).toBeNull();
  });

  it('returns null for non-range reference', () => {
    expect(isOutOfRange('7.5', 'N/A')).toBeNull();
  });

  it('uses the unit context to distinguish dotted thousands from decimals', () => {
    expect(isOutOfRange('1.720', '1.500 - 1.800', { unit: 'U/L' })).toBe(false);
  });

  it('keeps dotted values decimal for explicitly scaled cell units', () => {
    expect(isOutOfRange('7.280', '4.000 - 11.000', { unit: 'x10^3/uL' })).toBe(false);
  });
});

/* ================================================================== */
/*  normalizeAnalysisName                                              */
/* ================================================================== */

describe('normalizeAnalysisName', () => {
  it('normalizes "HCO3 ACTUAL" to "HCO3"', () => {
    expect(normalizeAnalysisName('HCO3 ACTUAL')).toBe('HCO3');
  });

  it('normalizes "Vol. Corp. Medio VCM" to "VCM"', () => {
    expect(normalizeAnalysisName('Vol. Corp. Medio VCM')).toBe('VCM');
    expect(normalizeAnalysisName('Hemoglobina Glicosilada')).toBe('Hb glicosilada');
    expect(normalizeAnalysisName('Triglic#ridos')).toBe('Trigliceridos');
  });

  it('passes through unmatched names', () => {
    expect(normalizeAnalysisName('Hemoglobina')).toBe('Hemoglobina');
  });

  it('normalizes common aliases to unified clinical labels', () => {
    expect(normalizeAnalysisName(' Leucocitos ')).toBe('Recuento Leucocitos');
    expect(normalizeAnalysisName('Plaquetas')).toBe('Recuento de Plaquetas');
    expect(normalizeAnalysisName('PCR')).toBe('Proteina C Reactiva');
  });

  it('keeps urine leukocytes as urine findings when section is urinary', () => {
    expect(normalizeAnalysisName('Leucocitos', 'ORINA FISICO-QUIMICO')).toBe('Leucocitos');
    expect(normalizeAnalysisName('Leucocitos', 'SEDIMENTO URINARIO')).toBe('Leucocitos');
  });

  it('normalizes urinary ratio labels to RPC and RAC', () => {
    expect(normalizeAnalysisName('Rel. Proteinuria/Creatininuria', 'QUIMICA/ORINA')).toBe('RPC');
    expect(normalizeAnalysisName('Relacion Albumina/Creatininuri', 'QUIMICA/ORINA')).toBe('RAC');
    expect(normalizeAnalysisName('Relación Albumina / Creatininuria', 'QUIMICA/ORINA')).toBe('RAC');
    expect(normalizeAnalysisName('RELAC. ALBUMINA/CREATINURIA', 'GENERAL')).toBe('RAC');
    expect(normalizeAnalysisName('Creatininuria', 'RELAC. ALBUMINA/CREATINURIA')).toBe(
      'Creatininuria'
    );
  });

  it('infers RPC and RAC from section/name combinations used by Syslab reports', () => {
    expect(normalizeAnalysisName('Rel. Proteinuria/Creatininuria = RPC', 'GENERAL')).toBe('RPC');
    expect(normalizeAnalysisName('', 'RELAC. ALBUMINA/CREATINURIA= RAC.')).toBe('RAC');
    expect(normalizeAnalysisName('Relacion Albumina/Creatininuri : 238,9', 'GENERAL')).toBe('RAC');
  });
});

/* ================================================================== */
/*  formatLabResult                                                    */
/* ================================================================== */

describe('formatLabResult', () => {
  it('returns regular value unchanged', () => {
    const result = formatLabResult('14,5', 'g/dL');
    expect(result).toEqual({ display: '14,5', displayUnit: 'g/dL' });
  });

  it('formats x10^3 unit (879 → 879.000)', () => {
    const result = formatLabResult('879', 'x10^3/ul');
    expect(result.display).toBe('879.000');
    expect(result.displayUnit).toBe('/ul');
  });

  it('formats x10^6 unit', () => {
    const result = formatLabResult('4', 'x10^6/ul');
    expect(result.displayUnit).toBe('/ul');
    // 4 * 10^6 = 4000000
    expect(result.display).toBe('4.000.000');
  });

  it('returns non-numeric value unchanged with sci unit', () => {
    const result = formatLabResult('N/A', 'x10^3/ul');
    expect(result).toEqual({ display: 'N/A', displayUnit: 'x10^3/ul' });
  });
});

/* ================================================================== */
/*  bedSortKey                                                         */
/* ================================================================== */

describe('bedSortKey', () => {
  it('R1 = 1', () => {
    expect(bedSortKey('R1')).toBe(1);
  });

  it('R4 = 4', () => {
    expect(bedSortKey('R4')).toBe(4);
  });

  it('NEO1 = 5', () => {
    expect(bedSortKey('NEO1')).toBe(5);
  });

  it('H1C1 = 10', () => {
    expect(bedSortKey('H1C1')).toBe(10);
  });

  it('H3C2 = 15', () => {
    expect(bedSortKey('H3C2')).toBe(15);
  });

  it('unknown bed = 100', () => {
    expect(bedSortKey('UNKNOWN')).toBe(100);
  });
});
