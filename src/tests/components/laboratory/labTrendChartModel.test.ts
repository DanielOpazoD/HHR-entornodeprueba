import { describe, expect, it } from 'vitest';
import { buildLabTrendChartModel } from '@/features/laboratory/components/labTrendChartModel';
import type { LabTrendPoint } from '@/types/domain/labAnalyticsTypes';
const point = (value: number, date = '22/10/2026 10:00'): LabTrendPoint => ({
  value,
  date,
  isoDate: '2026-10-22',
  unit: 'mg/dL',
});

describe('laboratory chart data integrity', () => {
  it('preserves small decimals and contains negative values without integer rounding', () => {
    const small = buildLabTrendChartModel({
      value: [point(0.004), point(0.006, '22/10/2026 11:00')],
    });
    expect(small.domain[1]).toBeLessThan(0.01);
    expect(small.chartData[0].values.value).toBe(0.004);
    const negative = buildLabTrendChartModel({ value: [point(-10), point(-5)] });
    expect(negative.domain[0]).toBeLessThan(-10);
    expect(negative.domain[1]).toBeGreaterThan(-5);
  });
  it('keeps data keys with punctuation independent from chart metadata', () => {
    const model = buildLabTrendChartModel({ date: [point(1)], 'A.B': [point(2)] });
    expect(model.chartData[0].date).toBe('22/10/2026 10:00');
    expect(model.chartData[0].values['A.B']).toBe(2);
  });
  it('keeps every measurement in dense charts while omitting overlapping labels', () => {
    const points = Array.from({ length: 80 }, (_, i) =>
      point(i, `22/10/2026 10:${String(i).padStart(2, '0')}`)
    );
    const model = buildLabTrendChartModel({ value: points });
    expect(model.chartData).toHaveLength(80);
    expect(model.showPointLabels).toBe(false);
    expect(buildLabTrendChartModel({ value: points.slice(0, 2) }).showPointLabels).toBe(true);
  });
  it('labels each month once while retaining all timestamps and points', () => {
    const model = buildLabTrendChartModel({
      value: [
        point(1, '01/05/2025 08:00'),
        point(2, '02/05/2025 10:00'),
        point(3, '01/05/2026 08:00'),
      ],
    });
    expect(model.axisTicks).toEqual(['01/05/2025 08:00', '01/05/2026 08:00']);
    expect(model.chartData).toHaveLength(3);
  });
  it('handles empty and invalid series without infinite SVG coordinates', () => {
    expect(buildLabTrendChartModel({ value: [point(NaN), point(Infinity)] }).domain).toEqual([
      0, 1,
    ]);
  });
  it('keeps separate orders and sorts dates across months chronologically', () => {
    const model = buildLabTrendChartModel({
      value: [
        point(3, '01/11/2026 10:00'),
        point(2, '22/10/2026 10:00 #2'),
        point(1, '22/10/2026 10:00 #1'),
      ],
    });
    expect(model.chartData.map(row => row.values.value)).toEqual([1, 2, 3]);
  });
});
