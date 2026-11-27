import type {
  DateRangeConfig,
  MinsalStatistics,
  SpecialtyReclassification,
} from '@/features/analytics/types/minsalTypes';
import { getDateRangeFromPreset } from '@/features/analytics/services/minsalStatsCalculator';
import type { DailyRecordMovementState as DailyRecord } from '@/types/domain/dailyRecordSlices';
import { diffCalendarDays } from '@/utils/clinicalDateUtils';
import { getTodayISO } from '@/utils/dateCoreUtils';

export interface RemoteStatsSnapshot {
  stats: MinsalStatistics;
  reclassificationsStamp: string | null;
}

export const REMOTE_RANGE_SYNC_INTERVAL_MS = 2 * 60 * 1000;

export const getCalendarDaysInRange = (start: string, end: string): number =>
  (diffCalendarDays(start, end) ?? 0) + 1;

export const getMinsalErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export const mergeRecordsByDateDesc = (
  base: DailyRecord[],
  incoming: DailyRecord[]
): DailyRecord[] => {
  const merged = new Map<string, DailyRecord>();
  base.forEach(record => merged.set(record.date, record));
  incoming.forEach(record => merged.set(record.date, record));
  return Array.from(merged.values()).sort((a, b) => b.date.localeCompare(a.date));
};

export const filterReclassificationsForRange = (
  items: SpecialtyReclassification[],
  startDate: string,
  endDate: string
): SpecialtyReclassification[] =>
  items.filter(item => !item.date || (item.date >= startDate && item.date <= endDate));

export const buildReclassificationsSignature = (items: SpecialtyReclassification[]): string =>
  items
    .map(item =>
      [
        item.date ?? '',
        item.movementKind,
        item.movementId,
        String(item.specialty),
        item.updatedAt ?? '',
      ].join('|')
    )
    .sort()
    .join(';');

export const buildVerifiedReclassificationsStamp = (
  dataUpdateCount: number,
  dataUpdatedAt: number,
  items: SpecialtyReclassification[]
): string => `${dataUpdateCount}:${dataUpdatedAt}:${buildReclassificationsSignature(items)}`;

export const resolveReclassificationsError = (error: unknown, isPaused: boolean): string | null => {
  if (error) {
    return getMinsalErrorMessage(
      error,
      'No se pudieron cargar las reclasificaciones estadísticas de especialidad.'
    );
  }
  if (isPaused) {
    return 'Sin conexión para verificar las reclasificaciones estadísticas de especialidad.';
  }
  return null;
};

export const resolveRemoteStatsWarning = (params: {
  isUsingRemoteStats: boolean;
  hasVisibleStats: boolean;
  error: unknown;
  isPaused: boolean;
}): string | null => {
  if (!params.isUsingRemoteStats || !params.hasVisibleStats) {
    return null;
  }
  if (params.error) {
    return getMinsalErrorMessage(
      params.error,
      'No se pudieron actualizar las estadísticas remotas del período.'
    );
  }
  if (params.isPaused) {
    return 'Sin conexión para actualizar las estadísticas remotas del período.';
  }
  return null;
};

export const resolveMinsalDisplayError = (params: {
  recordsError: unknown;
  remoteStatsIsError: boolean;
  remoteStatsError: unknown;
  hasLocalFallbackStats: boolean;
  hasRemoteStats: boolean;
  shouldUseRemoteStats: boolean;
  remoteStatsIsPaused: boolean;
  hasVisibleStats: boolean;
  reclassificationsError: string | null;
}): string | null => {
  if (params.recordsError) {
    return getMinsalErrorMessage(params.recordsError, 'Error loading records');
  }
  if (params.remoteStatsIsError && !params.hasLocalFallbackStats && !params.hasRemoteStats) {
    return getMinsalErrorMessage(params.remoteStatsError, 'Error loading remote statistics');
  }
  if (
    params.shouldUseRemoteStats &&
    params.remoteStatsIsPaused &&
    !params.hasVisibleStats &&
    !params.reclassificationsError
  ) {
    return 'Sin conexión para cargar las estadísticas remotas.';
  }
  return null;
};

export const resolveSafeMinsalDateRange = (
  dateRange: DateRangeConfig
): { startDate: string; endDate: string } => {
  try {
    return getDateRangeFromPreset(
      dateRange.preset,
      dateRange.startDate,
      dateRange.endDate,
      dateRange.currentYearMonth
    );
  } catch {
    const today = getTodayISO();
    return { startDate: today, endDate: today };
  }
};

export const isReclassificationsQueryVerified = (params: {
  status: string;
  error: unknown;
  isFetching: boolean;
  isPaused: boolean;
  isInvalidated: boolean;
  failureCount: number;
  isSavingReclassification: boolean;
}): boolean =>
  params.status === 'success' &&
  !params.error &&
  !params.isFetching &&
  !params.isPaused &&
  !params.isInvalidated &&
  params.failureCount === 0 &&
  !params.isSavingReclassification;

export const isRemoteStatsSnapshotStale = (params: {
  isUsingRemoteStats: boolean;
  currentVerifiedStamp: string | null;
  snapshot: RemoteStatsSnapshot | undefined;
}): boolean =>
  params.isUsingRemoteStats &&
  params.currentVerifiedStamp !== null &&
  Boolean(params.snapshot) &&
  params.snapshot?.reclassificationsStamp !== params.currentVerifiedStamp;

export const isRemoteStatsQueryVerified = (params: {
  isUsingRemoteStats: boolean;
  status: string;
  error: unknown;
  isFetching: boolean;
  isPaused: boolean;
  isStampStale: boolean;
  failureCount: number;
}): boolean =>
  !params.isUsingRemoteStats ||
  (params.status === 'success' &&
    !params.error &&
    !params.isFetching &&
    !params.isPaused &&
    !params.isStampStale &&
    params.failureCount === 0);
