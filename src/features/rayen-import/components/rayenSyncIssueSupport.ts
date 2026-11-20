import { isCalendarDate } from '@/utils/clinicalDateUtils';
import { BEDS } from '@/constants/beds';
import { previousCensusIsoDay } from '@/domain/evaluationScales/importedCudyr';
import type {
  RayenSyncCoverageIssue,
  RayenSyncFailureReason,
  RayenSyncIssueSource,
  RayenSyncStructuralIssueReason,
} from '@/types/domain/rayenSync';

const validCensusDay = (date?: string | null): date is string => !!date && isCalendarDate(date);

/** The copied code contains only bounded categories, never a bed, date or patient identifier. */
export const rayenSyncTechnicalCode = (
  source: RayenSyncIssueSource | 'run',
  reason:
    | RayenSyncCoverageIssue['reason']
    | RayenSyncStructuralIssueReason
    | RayenSyncFailureReason
    | 'partial'
    | 'unspecified'
): string => `HHR-SYNC-1/${source}/${reason}`;

export const rayenSyncCensusHref = (date?: string | null, bedId?: string | null): string | null => {
  if (!validCensusDay(date)) return null;
  if (bedId && !BEDS.some(bed => bed.id === bedId)) return null;
  const params = new URLSearchParams({ date });
  if (bedId) params.set('focusBed', bedId);
  return `/census?${params}`;
};

export const rayenClinicalIssueTarget = (
  issue: RayenSyncCoverageIssue,
  censusDate?: string | null
): { date: string; bedId: string | null } | null => {
  const detail = issue.source === 'cudyr' ? issue.cudyrRecovery : undefined;
  const date = detail ? detail.targetDate : censusDate;
  if (!validCensusDay(date)) return null;
  if (!detail && issue.reason === 'historical_census_write_failed') return null;
  const previousDay = !detail && issue.reason === 'historical_archive_failed';
  return {
    date: previousDay ? previousCensusIsoDay(date) : date,
    bedId: detail || previousDay || issue.bedId === '*' ? null : issue.bedId,
  };
};

export const rayenStructuralIssueHasCurrentBed = (
  reason: RayenSyncStructuralIssueReason
): boolean =>
  ![
    'historical-reconstruction',
    'historical-admission-evidence',
    'previous-census-continuity',
  ].includes(reason);
