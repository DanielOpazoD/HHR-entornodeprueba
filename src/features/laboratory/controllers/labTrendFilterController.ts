import type { LabTrendGroup, LabTrendPoint } from '@/types/domain/labAnalyticsTypes';

export type LabTrendTimeRange = '24h' | '3d' | '7d' | '30d' | 'all';

export interface LabTrendFilters {
  timeRange: LabTrendTimeRange;
  searchTerm: string;
  onlyAbnormal: boolean;
}

export interface LabTrendFocusResult {
  analysis: string;
  point: LabTrendPoint;
  isAbnormal: boolean;
}

const RANGE_DURATION_MS: Record<Exclude<LabTrendTimeRange, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const normalizeSearchToken = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es-CL')
    .trim();

export const parseLabTrendTimestamp = (point: Pick<LabTrendPoint, 'date' | 'isoDate'>): number => {
  const match = point.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (match) {
    return Date.UTC(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4] || 0),
      Number(match[5] || 0)
    );
  }

  const fallback = Date.parse(`${point.isoDate}T00:00:00Z`);
  return Number.isFinite(fallback) ? fallback : 0;
};

export const isLabTrendPointAbnormal = (point: LabTrendPoint): boolean =>
  (point.refMin != null && point.value < point.refMin) ||
  (point.refMax != null && point.value > point.refMax);

const getLatestTrendTimestamp = (groups: LabTrendGroup[]): number =>
  groups.reduce(
    (latest, group) =>
      Math.max(
        latest,
        ...Object.values(group.variables).flatMap(points => points.map(parseLabTrendTimestamp))
      ),
    0
  );

export const filterLabTrendGroups = (
  groups: LabTrendGroup[],
  filters: LabTrendFilters
): LabTrendGroup[] => {
  const latestTimestamp = getLatestTrendTimestamp(groups);
  const cutoff =
    filters.timeRange === 'all'
      ? Number.NEGATIVE_INFINITY
      : latestTimestamp - RANGE_DURATION_MS[filters.timeRange];
  const searchToken = normalizeSearchToken(filters.searchTerm);

  return groups.flatMap(group => {
    const groupMatchesSearch = normalizeSearchToken(group.label).includes(searchToken);
    const variables = Object.fromEntries(
      Object.entries(group.variables).flatMap(([analysis, points]) => {
        if (
          searchToken &&
          !groupMatchesSearch &&
          !normalizeSearchToken(analysis).includes(searchToken)
        ) {
          return [];
        }

        const visiblePoints = points.filter(point => parseLabTrendTimestamp(point) >= cutoff);
        if (visiblePoints.length === 0) return [];
        if (filters.onlyAbnormal && !visiblePoints.some(isLabTrendPointAbnormal)) return [];
        return [[analysis, visiblePoints]];
      })
    );

    return Object.keys(variables).length > 0 ? [{ ...group, variables }] : [];
  });
};

export const collectLabTrendFocusResults = (
  groups: LabTrendGroup[],
  activeDate: string | null
): LabTrendFocusResult[] => {
  if (!activeDate) return [];

  return groups
    .flatMap(group =>
      Object.entries(group.variables).flatMap(([analysis, points]) => {
        const point = points.find(candidate => candidate.date === activeDate);
        return point ? [{ analysis, point, isAbnormal: isLabTrendPointAbnormal(point) }] : [];
      })
    )
    .sort(
      (a, b) =>
        Number(b.isAbnormal) - Number(a.isAbnormal) || a.analysis.localeCompare(b.analysis, 'es')
    );
};

export const countLabTrendVariables = (groups: LabTrendGroup[]): number =>
  groups.reduce((total, group) => total + Object.keys(group.variables).length, 0);
