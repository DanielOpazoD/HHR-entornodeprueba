import { describe, expect, it } from 'vitest';

import {
  formatLabTrendValue,
  resolveSharedReferenceBand,
} from '@/features/laboratory/components/LabTrendChartHelpers';
import type { LabTrendPoint } from '@/types/domain/labAnalyticsTypes';

const point = (value: number, refMin: number, refMax: number): LabTrendPoint => ({
  date: '11/07/2026 00:09',
  isoDate: '2026-07-11',
  value,
  unit: 'U/L',
  refMin,
  refMax,
});

describe('LabTrendChartHelpers clinical presentation', () => {
  it('formats thousands and decimals using the clinical locale', () => {
    expect(formatLabTrendValue(1071)).toBe('1.071');
    expect(formatLabTrendValue(42.4)).toBe('42,4');
    expect(formatLabTrendValue(0.004)).toBe('0,004');
    expect(formatLabTrendValue(0.125)).toBe('0,125');
  });

  it('does not paint one analyte reference band over another analyte', () => {
    expect(
      resolveSharedReferenceBand({
        GGT: [point(1720, 10, 71)],
        'Fosfatasa Alcalina': [point(1071, 40, 129)],
      })
    ).toBeNull();
  });

  it('keeps the reference band when all variables share the same range', () => {
    expect(
      resolveSharedReferenceBand({
        first: [point(12, 4, 14)],
        second: [point(9, 4, 14)],
      })
    ).toEqual({ min: 4, max: 14 });
  });

  it('omits the band when a later point changes or loses its reference range', () => {
    expect(
      resolveSharedReferenceBand({
        changing: [point(12, 4, 14), point(13, 5, 15)],
      })
    ).toBeNull();
    expect(
      resolveSharedReferenceBand({
        incomplete: [point(12, 4, 14), { ...point(13, 4, 14), refMax: undefined }],
      })
    ).toBeNull();
  });
});
