import { describe, expect, it } from 'vitest';

import {
  formatClinicalNumber,
  formatDocumentSize,
} from '@/features/clinical-library/controllers/libraryPresentation';
import {
  PLAUSIBLE_RANGES,
  plausibleValue,
  rangeHint,
} from '@/features/clinical-library/controllers/plausibleRanges';
import { formatConcentration } from '@/features/clinical-library/controllers/infusionPresentation';

describe('library presentation helpers', () => {
  it('formats sizes with a binary megabyte threshold', () => {
    expect(formatDocumentSize(97)).toBe('97 KB');
    expect(formatDocumentSize(1000)).toBe('1000 KB');
    expect(formatDocumentSize(1024)).toBe('1 MB');
    expect(formatDocumentSize(7110)).toBe('6,9 MB');
  });

  it('never shows a real dose as zero', () => {
    expect(formatClinicalNumber(26.25)).toBe('26,3');
    expect(formatClinicalNumber(0.1)).toBe('0,1');
    expect(formatClinicalNumber(0.0004)).toBe('< 0,0005');
    expect(formatClinicalNumber(0.004, 2)).toBe('< 0,005');
    expect(formatClinicalNumber(0)).toBe('0');
    expect(formatClinicalNumber(1000)).toBe('1.000');
  });

  it('shows concentrations in the most readable unit', () => {
    expect(formatConcentration({ valuePerMl: 0.016, unit: 'mg' })).toBe('16 mcg/mL');
    expect(formatConcentration({ valuePerMl: 1, unit: 'mg' })).toBe('1 mg/mL');
    expect(formatConcentration({ valuePerMl: 10000, unit: 'mcg' })).toBe('10 mg/mL');
    expect(formatConcentration({ valuePerMl: 0.2, unit: 'UI' })).toBe('0,2 UI/mL');
  });
});

describe('plausible ranges', () => {
  it('separates empty, valid and implausible inputs', () => {
    expect(plausibleValue('', PLAUSIBLE_RANGES.weightKg)).toEqual({ value: null, invalid: false });
    expect(plausibleValue('abc', PLAUSIBLE_RANGES.weightKg)).toEqual({
      value: null,
      invalid: false,
    });
    expect(plausibleValue('70', PLAUSIBLE_RANGES.weightKg)).toEqual({ value: 70, invalid: false });
    expect(plausibleValue('-70', PLAUSIBLE_RANGES.weightKg)).toEqual({
      value: null,
      invalid: true,
    });
    expect(plausibleValue('1,70', PLAUSIBLE_RANGES.heightCm)).toEqual({
      value: null,
      invalid: true,
    });
    expect(
      rangeHint(plausibleValue('1,70', PLAUSIBLE_RANGES.heightCm), PLAUSIBLE_RANGES.heightCm)
    ).toBe('Fuera del rango plausible (30–250 cm).');
    expect(
      rangeHint(plausibleValue('170', PLAUSIBLE_RANGES.heightCm), PLAUSIBLE_RANGES.heightCm)
    ).toBeUndefined();
  });
});
