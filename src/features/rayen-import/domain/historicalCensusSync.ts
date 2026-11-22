import type { DailyRecord } from '@/types/domain/dailyRecord';
import { resolveCurrentClinicalDay } from '@/utils/clinicalDayAdmissionUtils';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { HistoricalSnapshotReconstruction } from './historicalSnapshotReconstruction';
import { RayenPlanningStop } from './rayenPlanningStop';

const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * A past date is eligible for evidence-based reconstruction regardless of its age. Eligibility
 * to query is not proof of upstream retention, population completeness or a historical bed.
 */

const isoDayInRapaNui = (date: Date): string => calendarStampInClinicalTimeZone(date).iso;

/** Census day currently under the responsibility of the active nursing shift in Rapa Nui. */
export const clinicalCensusDayInRapaNui = (now: Date = new Date()): string =>
  resolveCurrentClinicalDay(now);

export type CensusSyncTargetKind = 'current' | 'historical' | 'unsupported';

export interface CensusSyncTarget {
  kind: CensusSyncTargetKind;
  /** Rapa Nui calendar day at request time; may lead clinicalDay before handoff. */
  calendarDay: string;
  /** Clinical day that was active when the synchronization started. */
  clinicalDay: string;
  /** 0 for an accepted current target, positive for a past day, null when invalid. */
  lookbackDays: number | null;
}

const isoDayNumber = (iso: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [yearStr, monthStr, dayStr] = iso.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const timestamp = Date.UTC(year, month - 1, day);
  if (new Date(timestamp).toISOString().slice(0, 10) !== iso) return null;
  return timestamp / MILLISECONDS_PER_DAY;
};

export const resolveCensusSyncTarget = (
  censusIsoDay: string,
  now: Date = new Date()
): CensusSyncTarget => {
  const calendarDay = isoDayInRapaNui(now);
  const clinicalDay = clinicalCensusDayInRapaNui(now);
  const targetDayNumber = isoDayNumber(censusIsoDay);
  const clinicalDayNumber = isoDayNumber(clinicalDay);
  const clinicalLookbackDays =
    targetDayNumber === null || clinicalDayNumber === null
      ? null
      : clinicalDayNumber - targetDayNumber;
  // Before the morning handoff, a manually copied record for the new calendar date coexists with
  // the still-active previous clinical day. Both are explicit current targets; a run crossing the
  // handoff remains protected by validatePreparedRayenSyncContextAtCompletion.
  const isPreHandoffCalendarTarget =
    censusIsoDay === calendarDay && calendarDay !== clinicalDay && targetDayNumber !== null;
  const lookbackDays = isPreHandoffCalendarTarget ? 0 : clinicalLookbackDays;
  const kind: CensusSyncTargetKind =
    lookbackDays === 0
      ? 'current'
      : lookbackDays !== null && lookbackDays >= 1
        ? 'historical'
        : 'unsupported';
  return { kind, calendarDay, clinicalDay, lookbackDays };
};

export const classifyCensusSyncTargetDay = (
  censusIsoDay: string,
  now: Date = new Date()
): CensusSyncTargetKind => resolveCensusSyncTarget(censusIsoDay, now).kind;

export const isSupportedCensusSyncDay = (censusIsoDay: string, now: Date = new Date()): boolean =>
  classifyCensusSyncTargetDay(censusIsoDay, now) !== 'unsupported';

const occupiedPatientCount = (record: DailyRecord): number =>
  Object.values(record.beds).reduce((count, bed) => {
    const primary = bed.patientName?.trim() ? 1 : 0;
    const crib = bed.clinicalCrib?.patientName?.trim() ? 1 : 0;
    return count + primary + crib;
  }, 0);

/** An empty historical query cannot establish an empty population or confirm a blank bootstrap. */
export const assertHistoricalCensusHasEvidence = (
  record: DailyRecord,
  reconstruction: HistoricalSnapshotReconstruction,
  rows: readonly EgresoReportRow[]
): void => {
  const localContent =
    occupiedPatientCount(record) > 0 ||
    [record.discharges, record.transfers, record.cma].some(entries => entries?.length);
  const verifiedDayMovement = rows.some(
    row =>
      row.exactEpisodeVerification === 'verified' &&
      row.correctedDay === record.date &&
      /^\d+$/.test(row.encounterId ?? '')
  );
  if (
    localContent ||
    verifiedDayMovement ||
    reconstruction.snapshot.encounters.length ||
    reconstruction.conflicts.length
  )
    return;
  throw new RayenPlanningStop(
    'No hay evidencia suficiente en Eloísa para reconstruir este día. El censo no se confirmó como vacío.'
  );
};
