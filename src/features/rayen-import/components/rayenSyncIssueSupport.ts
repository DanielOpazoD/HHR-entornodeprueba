import { BEDS } from '@/constants/beds';
import { previousCensusIsoDay } from '@/domain/evaluationScales/importedCudyr';
import type {
  RayenSyncCoverageIssue,
  RayenSyncFailureReason,
  RayenSyncIssueSource,
  RayenSyncStructuralIssueReason,
} from '@/types/domain/rayenSync';

const validCensusDay = (date?: string | null): date is string => {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};

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
  if (!validCensusDay(censusDate)) return null;
  if (issue.reason === 'historical_census_write_failed') return null;
  if (issue.reason === 'historical_archive_failed') {
    // The coordinator archives D-1, but the recorded bed belongs to D. A move may have
    // changed its historical location, so only the known day is a trustworthy target.
    return { date: previousCensusIsoDay(censusDate), bedId: null };
  }
  return { date: censusDate, bedId: issue.bedId === '*' ? null : issue.bedId };
};

export const rayenStructuralIssueHasCurrentBed = (
  reason: RayenSyncStructuralIssueReason
): boolean =>
  ![
    'historical-reconstruction',
    'historical-admission-evidence',
    'previous-census-continuity',
  ].includes(reason);
