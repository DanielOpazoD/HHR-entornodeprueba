import { useEffect, useMemo } from 'react';
import { useCudyrReport } from './useCudyrReport';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { buildCudyrMonthlyIndicator } from '@/services/cudyr/cudyrMonthlyIndicator';
import { cudyrIndicatorFirstSync } from '@/services/cudyr/cudyrIndicatorRefresh';
import type { CudyrIndicatorRead } from '@/services/cudyr/cudyrIndicatorHistory';
import { getNextDay } from '@/utils/clinicalDayUtils';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';

/** Daily indicator snapshot. The detailed report keeps its interactive freshness policy. */
export const useCudyrIndicatorRead = (
  month: string,
  through: string,
  now: Date,
  onRead: (month: string, read: CudyrIndicatorRead) => void
) => {
  const { record } = useDailyRecordData();
  const day = getClinicalCalendarDateISO(now);
  const owner = getStoredSessionOwnerKey();
  const generation = getSessionGeneration();
  const scope = owner && generation ? `${owner}:${generation}` : '';
  // Structural application precedes clinical persistence; only use its completed pass.
  const completedAt =
    record && (record.date.slice(0, 7) === month || record.date === getNextDay(through))
      ? record.rayenSync?.coverage?.completedAt || ''
      : '';
  const firstSyncAt = useMemo(
    () => cudyrIndicatorFirstSync(scope, month, day, completedAt),
    [scope, month, day, completedAt]
  );
  const { data, busy, error } = useCudyrReport(through, undefined, undefined, false, {
    day,
    firstSyncAt,
  });
  const summary = useMemo(() => data && buildCudyrMonthlyIndicator(data, now), [data, now]);
  useEffect(() => onRead(month, { summary, busy, error }), [month, summary, busy, error, onRead]);
};
