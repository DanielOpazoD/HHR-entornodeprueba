import type { LabTrendPoint } from '@/types/domain/labAnalyticsTypes';
import {
  formatLabTrendAxisDate,
  resolveSharedReferenceBand,
  sortByDate,
} from './LabTrendChartHelpers';

export interface LabChartRow {
  date: string;
  __points: Record<string, LabTrendPoint>;
  values: Record<string, number>;
}

/** Pure chart preparation; presentation never rounds the measurements themselves. */
export const buildLabTrendChartModel = (variables: Record<string, LabTrendPoint[]>) => {
  const rows = new Map<string, LabChartRow>();
  let min = Infinity;
  let max = -Infinity;
  for (const [name, points] of Object.entries(variables)) {
    for (const point of points) {
      if (!Number.isFinite(point.value)) continue;
      let row = rows.get(point.date);
      if (!row) {
        row = { date: point.date, __points: {}, values: {} };
        rows.set(point.date, row);
      }
      row.values[name] = point.value;
      row.__points[name] = point;
      for (const value of [point.value, point.refMin, point.refMax]) {
        if (value != null && Number.isFinite(value)) {
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      }
    }
  }
  const chartData = [...rows.values()].sort((a, b) => sortByDate(a.date, b.date));
  const hasValues = Number.isFinite(min) && Number.isFinite(max);
  const padding = hasValues ? Math.max((max - min) * 0.12, Math.abs(max) * 0.05, 0.001) : 0;
  // Rounded tick boundaries improve readability without rounding the actual values.
  const rawStep = hasValues ? (max - min + 2 * padding) / 4 : 0.25;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const factor = [1, 2, 5, 10].find(candidate => candidate * magnitude >= rawStep) ?? 10;
  const step = factor * magnitude;
  const lower = Math.floor((min - padding) / step) * step;
  const upper = Math.ceil((max + padding) / step) * step;
  const domain: [number, number] = hasValues
    ? [min >= 0 ? Math.max(0, lower) : lower, upper]
    : [0, 1];
  const seenMonths = new Set<string>();
  const axisTicks = chartData
    .filter(row => {
      const label = formatLabTrendAxisDate(row.date);
      if (seenMonths.has(label)) return false;
      seenMonths.add(label);
      return true;
    })
    .map(row => row.date);
  return {
    chartData,
    axisTicks,
    domain,
    sharedReference: resolveSharedReferenceBand(variables),
    showPointLabels: chartData.length <= 6 && Object.keys(variables).length <= 2,
  };
};
