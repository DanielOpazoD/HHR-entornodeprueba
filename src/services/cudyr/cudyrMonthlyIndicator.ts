import type { CudyrReportDataset } from '@/types/domain/cudyrReport';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import { getPreviousDay } from '@/utils/clinicalDayUtils';
import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import { cudyrReportTotals } from './cudyrReportModel';
import { cudyrArchiveCoverage } from './cudyrArchiveCoverage';
import { cudyrCensusAccepted } from './cudyrCensusApproval';

/** Calendar month selected in HHR; today and future nights never contribute. */
export const cudyrMonthlyIndicatorRange = (date: string, now = new Date()) => {
  const month = date.slice(0, 7);
  const from = month + '-01';
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0))
    .toISOString()
    .slice(0, 10);
  const yesterday = getPreviousDay(getClinicalCalendarDateISO(now));
  const to = last < yesterday ? last : yesterday;
  return to < from ? null : { from, to };
};

export const buildCudyrMonthlyIndicator = (data: CudyrReportDataset, now = new Date()) => {
  const range = cudyrMonthlyIndicatorRange(data.from, now);
  const end = range && range.to < data.to ? range.to : data.to;
  const rows = data.rows.filter(row => range && row.date >= range.from && row.date <= end);
  const totals = cudyrReportTotals(rows);
  const evaluated = data.coverage.filter(
    day =>
      range &&
      day.date <= end &&
      resolveCudyrPendingStatus(day.date, new Date(data.generatedAt)).phase === 'overdue'
  );
  const archive = cudyrArchiveCoverage(data, new Date(data.generatedAt)).filter(
    day => range && day.date <= end
  );
  const partial = Boolean(
    data.issues.length ||
    totals.review ||
    archive.some(day => day.state === 'pending') ||
    evaluated.some(day => day.state !== 'disponible' || !cudyrCensusAccepted(day))
  );
  return {
    percentage: totals.eligible ? Math.round((100 * totals.categorized) / totals.eligible) : null,
    eligible: totals.eligible,
    categorized: totals.categorized,
    through: evaluated.at(-1)?.date,
    quality: data.officialSnapshot && !partial ? 'Oficial' : 'Provisional',
  };
};
