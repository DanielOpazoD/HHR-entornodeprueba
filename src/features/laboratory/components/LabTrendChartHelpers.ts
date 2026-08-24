import type { LabTrendPoint } from '@/types/domain/labAnalyticsTypes';
import { SCALE_SPLIT_RATIO } from '../constants/labChartConstants';

export interface UnitVariableGroup {
  unit: string;
  vars: Record<string, LabTrendPoint[]>;
}

export interface SharedReferenceBand {
  min: number;
  max: number;
}

const labNumberFormatter = new Intl.NumberFormat('es-CL', {
  maximumFractionDigits: 6,
});

/** Formats chart values without turning 1071 into 1.1 or adding false precision. */
export const formatLabTrendValue = (value: number): string => labNumberFormatter.format(value);

/** Compact axis label that preserves date and time without repeating the year. */
export const formatLabTrendAxisDate = (date: string): string => {
  const match = date.match(/^(\d{1,2})\/(\d{1,2})\/\d{4}(?:\s+(\d{1,2}:\d{2}))?/);
  if (!match) return date;
  return `${match[1].padStart(2, '0')}/${match[2].padStart(2, '0')}${match[3] ? ` ${match[3]}` : ''}`;
};

/** A shared band is valid only when every plotted variable has the same reference range. */
export const resolveSharedReferenceBand = (
  variables: Record<string, LabTrendPoint[]>
): SharedReferenceBand | null => {
  const ranges = Object.values(variables).flatMap(points =>
    points.map(point =>
      point.refMin != null && point.refMax != null ? { min: point.refMin, max: point.refMax } : null
    )
  );
  if (ranges.length === 0 || ranges.some(range => range == null)) return null;
  const first = ranges[0]!;
  return ranges.every(range => range?.min === first.min && range.max === first.max) ? first : null;
};

interface VariableMagnitudeEntry {
  name: string;
  pts: LabTrendPoint[];
  mag: number;
}

/**
 * Compute the representative magnitude of a variable (median of its max values).
 */
const varMagnitude = (points: LabTrendPoint[]): number => {
  const vals = points.map(point => Math.abs(point.value)).sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)] || 0;
};

/** Cluster sorted items by magnitude ratio. Groups split when ratio exceeds threshold. */
const clusterByMagnitude = (
  sortedItems: VariableMagnitudeEntry[],
  ratio: number
): VariableMagnitudeEntry[][] => {
  const clusters: VariableMagnitudeEntry[][] = [[]];
  let clusterMin = sortedItems[0]?.mag || 1;

  for (const item of sortedItems) {
    const r = (item.mag || 1) / (clusterMin || 1);
    if (r > ratio && clusters[clusters.length - 1].length > 0) {
      clusters.push([]);
      clusterMin = item.mag || 1;
    }

    clusters[clusters.length - 1].push(item);
    if (item.mag < clusterMin) clusterMin = item.mag;
  }

  return clusters;
};

/**
 * Group variables by unit, then further split by scale when values differ
 * drastically (e.g., Fosfatasa Alcalina ~500 vs GOT/GPT ~15 in the same U/L group).
 * This prevents small-value lines from being squished at the bottom.
 */
export const groupVariablesByScale = (
  variables: Record<string, LabTrendPoint[]>
): UnitVariableGroup[] => {
  const byUnit: Record<string, Record<string, LabTrendPoint[]>> = {};

  for (const [name, points] of Object.entries(variables)) {
    const unit = (points[0]?.unit || '').toLowerCase().replace(/\s/g, '');
    if (!byUnit[unit]) byUnit[unit] = {};
    byUnit[unit][name] = points;
  }

  const result: UnitVariableGroup[] = [];

  for (const unitVars of Object.values(byUnit)) {
    const displayUnit = Object.values(unitVars)[0]?.[0]?.unit || '';
    const entries = Object.entries(unitVars);

    if (entries.length <= 1) {
      result.push({ unit: displayUnit, vars: Object.fromEntries(entries) });
      continue;
    }

    const withMag = entries.map(([name, pts]) => ({ name, pts, mag: varMagnitude(pts) }));
    withMag.sort((a, b) => a.mag - b.mag);

    const clusters = clusterByMagnitude(withMag, SCALE_SPLIT_RATIO);

    for (const cluster of clusters) {
      const vars: Record<string, LabTrendPoint[]> = {};
      for (const { name, pts } of cluster) vars[name] = pts;
      result.push({ unit: displayUnit, vars });
    }
  }

  return result;
};

/** Sort date strings that start with DD/MM/YYYY. */
export const sortByDate = (a: string, b: string): number => {
  const isoA = a.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1');
  const isoB = b.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1');
  return isoA.localeCompare(isoB);
};
