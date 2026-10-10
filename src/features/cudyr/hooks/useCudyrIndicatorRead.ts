import { useEffect, useMemo } from 'react';
import { useCudyrReport } from './useCudyrReport';
import { useDailyRecordData } from '@/context/DailyRecordContext';
import { buildCudyrMonthlyIndicator } from '@/services/cudyr/cudyrMonthlyIndicator';
import type { CudyrIndicatorRead } from '@/services/cudyr/cudyrIndicatorHistory';

/** Reuses the session-owned report cache and Firebase reader. No Eloísa access. */
export const useCudyrIndicatorRead = (
  month: string,
  through: string,
  now: Date,
  onRead: (month: string, read: CudyrIndicatorRead) => void
) => {
  const { record, bootstrapPhase } = useDailyRecordData();
  const { data, busy, error } = useCudyrReport(
    through,
    undefined,
    record?.date.slice(0, 7) === month
      ? {
          date: record?.date || '',
          version: record
            ? `present:${record.lastUpdated || ''}:${record.rayenSync?.at || ''}:${record.cudyrUpdatedAt || ''}`
            : bootstrapPhase === 'confirmed_empty'
              ? 'missing'
              : '',
        }
      : undefined,
    true
  );
  const summary = useMemo(() => data && buildCudyrMonthlyIndicator(data, now), [data, now]);
  useEffect(() => onRead(month, { summary, busy, error }), [month, summary, busy, error, onRead]);
};
