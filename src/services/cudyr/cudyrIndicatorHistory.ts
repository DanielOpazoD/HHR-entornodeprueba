import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import type { buildCudyrMonthlyIndicator } from './cudyrMonthlyIndicator';

export const CUDYR_INDICATOR_START = '2026-08';
export type CudyrIndicatorSummary = ReturnType<typeof buildCudyrMonthlyIndicator>;
export interface CudyrIndicatorRead {
  summary: CudyrIndicatorSummary | null;
  busy: boolean;
  error: string;
}

/** Only the cleaned history is offered; future months never appear. */
export const cudyrIndicatorMonths = (now: Date) => {
  const last = getClinicalCalendarDateISO(now).slice(0, 7);
  const months: string[] = [];
  for (let month = CUDYR_INDICATOR_START; month <= last; ) {
    months.push(month);
    const next = new Date(`${month}-01T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    month = next.toISOString().slice(0, 7);
  }
  return months;
};

/** Weighted patient-day compliance, never a mean of rounded monthly rates. */
export const cudyrIndicatorAnnual = (
  months: string[],
  throughMonth: string,
  reads: Record<string, CudyrIndicatorRead>
) => {
  const included = months.filter(
    month => month.slice(0, 4) === throughMonth.slice(0, 4) && month <= throughMonth
  );
  const results = included.map(month => reads[month]);
  const eligible = results.reduce((sum, read) => sum + (read?.summary?.eligible || 0), 0);
  const categorized = results.reduce((sum, read) => sum + (read?.summary?.categorized || 0), 0);
  const missing = results.some(read => !read?.summary);
  return {
    from: included[0],
    eligible,
    categorized,
    percentage: missing || !eligible ? null : Math.round((100 * categorized) / eligible),
    missing,
    busy: results.some(read => !read || read.busy),
    error: results.some(read => Boolean(read?.error)),
    provisional: results.some(read => read?.summary?.quality !== 'Oficial'),
  };
};
