import { useEffect, useMemo } from 'react';
import { useCudyrReport } from './useCudyrReport';
import { useDailyRecordMeta } from '@/context/DailyRecordContext';
import { buildCudyrMonthlyIndicator } from '@/features/cudyr/indicator/cudyrMonthlyIndicator';
import { cudyrIndicatorFirstSync } from '@/features/cudyr/indicator/cudyrIndicatorRefresh';
import type { CudyrIndicatorRead } from '@/features/cudyr/indicator/cudyrIndicatorHistory';
import { getNextDay } from '@/utils/clinicalDayUtils';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { authoringSessionScope } from '@/services/session/authoringSession';

/** Daily indicator snapshot. The detailed report keeps its interactive freshness policy. */
export const useCudyrIndicatorRead = (
  month: string,
  through: string,
  now: Date,
  onRead: (month: string, read: CudyrIndicatorRead) => void
) => {
  const { date: recordDate, rayenCoverageCompletedAt } = useDailyRecordMeta();
  const day = getClinicalCalendarDateISO(now);
  const scope = authoringSessionScope();
  // Structural application precedes clinical persistence; only use its completed pass.
  const completedAt =
    recordDate && (recordDate.slice(0, 7) === month || recordDate === getNextDay(through))
      ? rayenCoverageCompletedAt
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
