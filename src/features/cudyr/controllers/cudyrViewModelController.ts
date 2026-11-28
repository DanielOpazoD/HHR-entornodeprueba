import { resolveCudyrPendingStatus } from '@/domain/cudyr/cudyrPending';
import { cudyrArchiveCoverage } from '@/services/cudyr/cudyrArchiveCoverage';
import { cudyrCensusAccepted } from '@/services/cudyr/cudyrCensusApproval';
import { cudyrReportIsVerified } from '@/services/cudyr/cudyrReportCache';
import { cudyrReportTotals } from '@/services/cudyr/cudyrReportModel';
import type {
  CudyrReportDataset,
  CudyrReportRow,
  CudyrReportTotals,
} from '@/types/domain/cudyrReport';
import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';

export interface CudyrRecordVersionInput {
  date: string;
  record?: {
    date?: string;
    lastUpdated?: string;
    rayenSync?: { at?: string };
    cudyrUpdatedAt?: string;
  } | null;
  bootstrapPhase?: string;
}

export interface BuildCudyrViewModelInput {
  data: CudyrReportDataset | null | undefined;
  date: string;
  filter: string;
  selectedRowKey: string;
  busy: boolean;
  error: string;
  now?: Date;
}

export interface CudyrFilterCounts {
  all: number;
  elegible: number;
  no_elegible: number;
  por_revisar: number;
}

export interface CudyrViewModel {
  rows: CudyrReportRow[];
  visibleRows: CudyrReportRow[];
  filterCounts: CudyrFilterCounts;
  totals: CudyrReportTotals;
  daily: CudyrReportTotals;
  dayPending: boolean;
  dayHasEnded: boolean;
  dailyProvisional: boolean;
  lastEvaluated: string | undefined;
  dailyPercentage: string;
  percentage: string;
  partial: boolean;
  isOfficialRepaired: boolean;
  canExport: boolean;
  selectedRow: CudyrReportRow | undefined;
}

const formatCompliancePercentage = (categorized: number, eligible: number): string =>
  eligible ? `${Math.round((100 * categorized) / eligible)}%` : '—';

export const buildCudyrRecordVersion = ({
  date,
  record,
  bootstrapPhase,
}: CudyrRecordVersionInput): { date: string; version: string } => ({
  date,
  version:
    record?.date === date
      ? `present:${record.lastUpdated || ''}:${record.rayenSync?.at || ''}:${record.cudyrUpdatedAt || ''}`
      : !record && bootstrapPhase === 'confirmed_empty'
        ? 'missing'
        : '',
});

export const buildCudyrViewModel = ({
  data,
  date,
  filter,
  selectedRowKey,
  busy,
  error,
  now,
}: BuildCudyrViewModelInput): CudyrViewModel => {
  const rows = data?.rows.filter(row => row.date === date && !row.resolvedSystemDeparture) ?? [];
  const visibleRows = rows.filter(row => filter === 'all' || row.eligibility === filter);
  const filterCounts: CudyrFilterCounts = {
    all: rows.length,
    elegible: rows.filter(row => row.eligibility === 'elegible').length,
    no_elegible: rows.filter(row => row.eligibility === 'no_elegible').length,
    por_revisar: rows.filter(row => row.eligibility === 'por_revisar').length,
  };
  const totals = cudyrReportTotals(data?.rows ?? []);
  const asOf = data?.generatedAt ? new Date(data.generatedAt) : (now ?? new Date());
  const archiveDays = data ? cudyrArchiveCoverage(data, asOf) : [];
  const archivePending = archiveDays.filter(day => day.state === 'pending').length;
  const censusPending = archiveDays.filter(
    day =>
      day.state !== 'open' && !cudyrCensusAccepted(data?.coverage.find(d => d.date === day.date))
  ).length;
  const dayPending = resolveCudyrPendingStatus(date, asOf).phase !== 'overdue';
  const dayHasEnded = date < getClinicalCalendarDateISO(asOf);
  const daily = cudyrReportTotals(rows, { includePendingApplication: dayHasEnded });
  const dayCoverage = data?.coverage.find(day => day.date === date);
  const dailyProvisional =
    dayHasEnded &&
    Boolean(
      dayPending ||
      !cudyrCensusAccepted(dayCoverage) ||
      archiveDays.find(day => day.date === date)?.state === 'pending' ||
      daily.review ||
      data?.issues.length ||
      dayCoverage?.state !== 'disponible'
    );
  const evaluatedCoverage =
    data?.coverage.filter(day => resolveCudyrPendingStatus(day.date, asOf).phase === 'overdue') ??
    [];
  const lastEvaluated = evaluatedCoverage.at(-1)?.date;
  const dailyPercentage = dayHasEnded
    ? formatCompliancePercentage(daily.categorized, daily.eligible)
    : '—';
  const percentage = formatCompliancePercentage(totals.categorized, totals.eligible);
  const partial = Boolean(
    data &&
    (archivePending ||
      censusPending ||
      data.issues.length ||
      evaluatedCoverage.some(day => day.state !== 'disponible') ||
      totals.review)
  );
  const isOfficialRepaired = Boolean(
    !partial &&
    data?.coverage.length &&
    data.coverage.every(day => Boolean(day.reconstructionApproval))
  );
  const canExport = cudyrReportIsVerified(data, busy, error, evaluatedCoverage);
  const selectedRow =
    !busy && !data?.readViewSnapshot
      ? data?.rows.find(row => row.key === selectedRowKey && row.date === date)
      : undefined;

  return {
    rows,
    visibleRows,
    filterCounts,
    totals,
    daily,
    dayPending,
    dayHasEnded,
    dailyProvisional,
    lastEvaluated,
    dailyPercentage,
    percentage,
    partial,
    isOfficialRepaired,
    canExport,
    selectedRow,
  };
};
