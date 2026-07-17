import type { CensusImportDiff } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';

const RAPA_NUI_TIME_ZONE = 'Pacific/Easter';

const isoDayInRapaNui = (date: Date): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RAPA_NUI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};

/** Historical censuses never inherit today's structural state from the live Eloisa snapshot. */
export const isHistoricalCensusDay = (censusIsoDay: string, now: Date = new Date()): boolean =>
  censusIsoDay < isoDayInRapaNui(now);

const occupiedPatientCount = (record: DailyRecord): number =>
  Object.values(record.beds).reduce((count, bed) => {
    const primary = bed.patientName?.trim() ? 1 : 0;
    const crib = bed.clinicalCrib?.patientName?.trim() ? 1 : 0;
    return count + primary + crib;
  }, 0);

/**
 * Converts a live-snapshot reconciliation into a clinical-only historical run.
 *
 * The current Ficha Medico snapshot cannot establish when an admission, discharge or bed move
 * happened. For a past census its existing structure is therefore authoritative; only the
 * date-aware clinical fill may patch it.
 */
export const toHistoricalClinicalOnlyDiff = (
  diff: CensusImportDiff,
  record: DailyRecord
): CensusImportDiff => {
  const unchangedCount = occupiedPatientCount(record);
  return {
    ...diff,
    admissions: [],
    updates: [],
    moves: [],
    discharges: [],
    pendingAdministrativeDischarges: [],
    conflicts: [],
    reportEgresos: [],
    previousDayEdits: [],
    unchangedCount,
    summary: {
      admissions: 0,
      updates: 0,
      moves: 0,
      discharges: 0,
      pendingAdministrativeDischarges: 0,
      conflicts: 0,
      unchanged: unchangedCount,
      previousDaysAffected: 0,
    },
  };
};
