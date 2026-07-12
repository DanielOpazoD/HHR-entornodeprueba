/**
 * Merges the vital signs parsed from Ficha Médico into a patient's HHR record: `vitalSigns` (the
 * latest measurement on or before the census day, for the census cell) and `vitalSignsHistory` (the
 * most-recent measurements up to that day, so the detail view can show several days). Self-contained
 * like `mergeReportScales`. Ficha Médico is the source of truth, so it replaces both fields.
 */

import type { PatientData } from '../contracts/rayenDomainContracts';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

export interface MergeVitalsContext {
  /** The census day being synced (YYYY-MM-DD, Rapa Nui local). */
  censusIsoDay: string;
}

/**
 * How many measurements to keep — enough for "7 días o más" at typical ward frequency (~3–4/day)
 * while bounding the daily-record document size for busy (ICU-hourly) patients.
 */
const MAX_VITALS_HISTORY = 48;

export const mergeReportVitals = (
  patient: PatientData,
  records: PatientVitalSigns[],
  ctx: MergeVitalsContext
): PatientData => {
  if (records.length === 0) return patient;
  // `records` arrive most-recent-first; keep those on or before the census day, capped.
  const history = records
    .filter(record => record.recordedDate <= ctx.censusIsoDay)
    .slice(0, MAX_VITALS_HISTORY);
  if (history.length === 0) return patient;
  return { ...patient, vitalSigns: history[0], vitalSignsHistory: history };
};
