import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import { resolveClinicalDayForDateTime } from '@/utils/clinicalDayAdmissionUtils';

const RAPA_NUI_TIME_ZONE = 'Pacific/Easter';
const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * Product contract for delayed census reconstruction.
 *
 * Rayen currently retains evidence for longer (13 days was verified on 25-07-2026), but HHR only
 * promises the seven previous clinical days. Keeping the supported window explicit prevents an
 * incidental upstream retention period from silently becoming a clinical guarantee.
 */
export const MAX_HISTORICAL_CENSUS_LOOKBACK_DAYS = 7;

const calendarStampInRapaNui = (date: Date): { iso: string; hhmm: string } => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RAPA_NUI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(part => part.type === type)?.value ?? '';
  return {
    iso: `${value('year')}-${value('month')}-${value('day')}`,
    hhmm: `${value('hour')}:${value('minute')}`,
  };
};

const isoDayInRapaNui = (date: Date): string => calendarStampInRapaNui(date).iso;

/** Census day currently under the responsibility of the active nursing shift in Rapa Nui. */
export const clinicalCensusDayInRapaNui = (now: Date = new Date()): string => {
  const { iso, hhmm } = calendarStampInRapaNui(now);
  return resolveClinicalDayForDateTime(iso, hhmm) ?? iso;
};

export type CensusSyncTargetKind = 'current' | 'historical' | 'unsupported';

export interface CensusSyncTarget {
  kind: CensusSyncTargetKind;
  /** Rapa Nui calendar day at request time; may lead clinicalDay before handoff. */
  calendarDay: string;
  /** Clinical day that was active when the synchronization started. */
  clinicalDay: string;
  /** 0 for D, 1..7 for an accepted historical day, null when unsupported or malformed. */
  lookbackDays: number | null;
}

const isoDayNumber = (iso: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [year, month, day] = iso.split('-').map(Number);
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
  const lookbackDays =
    targetDayNumber === null || clinicalDayNumber === null
      ? null
      : clinicalDayNumber - targetDayNumber;
  const kind: CensusSyncTargetKind =
    lookbackDays === 0
      ? 'current'
      : lookbackDays !== null &&
          lookbackDays >= 1 &&
          lookbackDays <= MAX_HISTORICAL_CENSUS_LOOKBACK_DAYS
        ? 'historical'
        : 'unsupported';
  return { kind, calendarDay, clinicalDay, lookbackDays };
};

export const classifyCensusSyncTargetDay = (
  censusIsoDay: string,
  now: Date = new Date()
): CensusSyncTargetKind => resolveCensusSyncTarget(censusIsoDay, now).kind;

const timestampDayInRapaNui = (value?: string): string => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : isoDayInRapaNui(date);
};

/** Historical censuses never inherit today's structural state from the live Eloisa snapshot. */
export const isHistoricalCensusDay = (censusIsoDay: string, now: Date = new Date()): boolean =>
  censusIsoDay < clinicalCensusDayInRapaNui(now);

export const isCurrentCensusDay = (censusIsoDay: string, now: Date = new Date()): boolean =>
  classifyCensusSyncTargetDay(censusIsoDay, now) === 'current';

/** Exact D-1 predicate retained for callers that specifically need the immediately prior day. */
export const isPreviousCensusDay = (censusIsoDay: string, now: Date = new Date()): boolean =>
  resolveCensusSyncTarget(censusIsoDay, now).lookbackDays === 1;

/** True for a supported historical target from D-1 through D-7. */
export const isHistoricalCensusSyncDay = (censusIsoDay: string, now: Date = new Date()): boolean =>
  classifyCensusSyncTargetDay(censusIsoDay, now) === 'historical';

export const isSupportedCensusSyncDay = (censusIsoDay: string, now: Date = new Date()): boolean =>
  classifyCensusSyncTargetDay(censusIsoDay, now) !== 'unsupported';

const occupiedPatientCount = (record: DailyRecord): number =>
  Object.values(record.beds).reduce((count, bed) => {
    const primary = bed.patientName?.trim() ? 1 : 0;
    const crib = bed.clinicalCrib?.patientName?.trim() ? 1 : 0;
    return count + primary + crib;
  }, 0);

const normalizeRut = (value?: string): string =>
  (value ?? '').replace(/[^0-9kK]/g, '').toUpperCase();

const hasSameStableIdentity = (
  historical: DailyRecord['beds'][string],
  live: DailyRecord['beds'][string]
): boolean => {
  const historicalEpisode = historical.clinicalEpisodeId?.trim();
  const liveEpisode = live.clinicalEpisodeId?.trim();
  if (historicalEpisode && liveEpisode) return historicalEpisode === liveEpisode;

  const historicalRut = normalizeRut(historical.rut);
  const liveRut = normalizeRut(live.rut);
  return !!historicalRut && !!liveRut && historicalRut === liveRut;
};

const isSafeAttachedCribBackfill = (
  update: CensusImportDiff['updates'][number],
  record: DailyRecord
): boolean => {
  const parent = record.beds[update.bedId];
  if (
    !parent?.patientName?.trim() ||
    parent.isBlocked ||
    parent.clinicalCrib?.patientName?.trim()
  ) {
    return false;
  }
  if (update.source?.clinicalCribParentBedId !== update.bedId) return false;
  if (!hasSameStableIdentity(parent, update.patient)) return false;

  const cribChange = update.changes.find(change => change.field === 'clinicalCrib');
  const incomingCrib = cribChange?.to as DailyRecord['beds'][string] | undefined;
  const wasEmpty = !(
    cribChange?.from as DailyRecord['beds'][string] | undefined
  )?.patientName?.trim();
  const dischargeDay = timestampDayInRapaNui(update.source?.dischargeDatetime);
  const hasAuthoritativeEpisodeEnd = !!dischargeDay || update.source?.hasMedicalDischarge === false;
  const belongsToHistoricalDay =
    !!incomingCrib?.patientName?.trim() &&
    !!incomingCrib.clinicalEpisodeId &&
    !!incomingCrib.admissionDate &&
    incomingCrib.admissionDate <= record.date &&
    hasAuthoritativeEpisodeEnd &&
    (!dischargeDay || record.date <= dischargeDay);
  const onlyCribFields = update.changes.every(
    change => change.field === 'clinicalCrib' || change.field === 'hasCompanionCrib'
  );

  return wasEmpty && belongsToHistoricalDay && onlyCribFields;
};

/**
 * Converts a live-snapshot reconciliation into a safe historical run.
 *
 * The current Ficha Medico snapshot cannot establish when an admission, discharge or bed move
 * happened. For a past census its existing structure is therefore authoritative. The sole
 * structural exception is an attached crib whose episode started on or before that census day,
 * whose mother is still in the same confirmed principal bed, and whose historical crib slot is
 * empty. This gives the user a reviewable backfill without projecting today's other structure into
 * yesterday.
 */
export const toSafeHistoricalDiff = (
  diff: CensusImportDiff,
  record: DailyRecord
): CensusImportDiff => {
  const unchangedCount = occupiedPatientCount(record);
  const safeCribUpdates = diff.updates.filter(update => isSafeAttachedCribBackfill(update, record));
  return {
    ...diff,
    admissions: [],
    updates: safeCribUpdates,
    moves: [],
    discharges: [],
    pendingAdministrativeDischarges: [],
    conflicts: [],
    reportEgresos: [],
    previousDayEdits: [],
    unchangedCount,
    summary: {
      admissions: 0,
      updates: safeCribUpdates.length,
      moves: 0,
      discharges: 0,
      pendingAdministrativeDischarges: 0,
      conflicts: 0,
      unchanged: unchangedCount,
      previousDaysAffected: 0,
    },
  };
};
