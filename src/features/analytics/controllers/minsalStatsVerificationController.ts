import type { SpecialtyReclassification } from '@/features/analytics/types/minsalTypes';
import type { DailyRecordMovementState as DailyRecord } from '@/types/domain/dailyRecordSlices';

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
