import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import { resolveCurrentClinicalDay } from '@/utils/clinicalDayAdmissionUtils';
import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import type { EgresoReportRow } from '../contracts/egresoReport';
import type { HistoricalSnapshotReconstruction } from './historicalSnapshotReconstruction';

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

/** True for any valid past clinical day; evidence is checked separately for each episode. */
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
  throw new Error(
    'No hay evidencia suficiente en Eloísa para reconstruir este día. El censo no se confirmó como vacío.'
  );
};

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
  return wasEmpty && belongsToHistoricalDay;
};

const safeHistoricalPhysicianNameBackfill = (
  update: CensusImportDiff['updates'][number],
  record: DailyRecord
): CensusImportDiff['updates'][number] | null => {
  const historical = record.beds[update.bedId];
  if (!historical || !update.patient || !hasSameStableIdentity(historical, update.patient)) {
    return null;
  }

  const historicalPhysicianId = historical.treatingPhysicianId?.trim();
  const incomingPhysicianId = update.patient.treatingPhysicianId?.trim();
  const incomingName = update.patient.treatingPhysicianName?.trim();
  if (
    !historicalPhysicianId ||
    historicalPhysicianId !== incomingPhysicianId ||
    historical.treatingPhysicianName?.trim() ||
    !incomingName
  ) {
    return null;
  }

  const nameChange = update.changes.find(
    change =>
      change.field === 'treatingPhysicianName' &&
      !String(change.from ?? '').trim() &&
      String(change.to ?? '').trim() === incomingName
  );
  return nameChange ? { ...update, changes: [nameChange] } : null;
};

const patientWithHistoricalChanges = (
  historical: DailyRecord['beds'][string],
  changes: CensusImportDiff['updates'][number]['changes']
): DailyRecord['beds'][string] => {
  const patient = { ...historical } as unknown as Record<string, unknown>;
  for (const change of changes) patient[change.field] = change.to;
  return patient as unknown as DailyRecord['beds'][string];
};

/**
 * Converts a live-snapshot reconciliation into a safe historical run.
 *
 * The current Ficha Medico snapshot cannot establish when an admission, discharge or bed move
 * happened. For a past census its existing structure is therefore authoritative. The sole
 * structural exception is an attached crib whose episode started on or before that census day,
 * whose mother is still in the same confirmed principal bed, and whose historical crib slot is
 * empty. A missing physician display name may also be completed when the historical episode
 * already stores the exact same stable physician id. Neither exception can replace historical
 * identity or project today's structural state into yesterday.
 */
export const toSafeHistoricalDiff = (
  diff: CensusImportDiff,
  record: DailyRecord
): CensusImportDiff => {
  const unchangedCount = occupiedPatientCount(record);
  const safeUpdates = diff.updates.flatMap(update => {
    const historical = record.beds[update.bedId];
    if (!historical) return [];
    const safeChanges = isSafeAttachedCribBackfill(update, record)
      ? update.changes.filter(
          change => change.field === 'clinicalCrib' || change.field === 'hasCompanionCrib'
        )
      : [];
    const physicianNameBackfill = safeHistoricalPhysicianNameBackfill(update, record);
    if (physicianNameBackfill) safeChanges.push(...physicianNameBackfill.changes);
    return safeChanges.length > 0
      ? [
          {
            ...update,
            patient: patientWithHistoricalChanges(historical, safeChanges),
            changes: safeChanges,
          },
        ]
      : [];
  });
  return {
    ...diff,
    admissions: [],
    updates: safeUpdates,
    moves: [],
    discharges: [],
    pendingAdministrativeDischarges: [],
    conflicts: [],
    reportEgresos: [],
    previousDayEdits: [],
    unchangedCount,
    summary: {
      admissions: 0,
      updates: safeUpdates.length,
      moves: 0,
      discharges: 0,
      pendingAdministrativeDischarges: 0,
      conflicts: 0,
      unchanged: unchangedCount,
      previousDaysAffected: 0,
    },
  };
};
