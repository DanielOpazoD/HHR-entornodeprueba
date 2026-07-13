/**
 * Merges the vital signs parsed from Ficha Médico into a patient's HHR record: `vitalSigns` (the
 * glance shown in the census cell) and `vitalSignsHistory` (the most-recent measurements, so the
 * detail view can show several days). Self-contained like `mergeReportScales`. Ficha Médico is the
 * source of truth, so it replaces both fields.
 *
 * Range: ALL available measurements are synced — both BEFORE and AFTER the census day being synced.
 * A late sync of a past census still picks up later readings, so the vitals are never artificially
 * cut off at the census day.
 */

import type { PatientData } from '../contracts/rayenDomainContracts';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';

/**
 * How many measurements to keep — enough for "7 días o más" at typical ward frequency (~3–4/day)
 * while bounding the daily-record document size for busy (ICU-hourly) patients.
 */
const MAX_VITALS_HISTORY = 48;

/** A "core" vital worth a census glance: PA, FC, SatO₂ or T°. HGT/insulin-only forms don't count. */
const hasCoreVital = (record: PatientVitalSigns): boolean =>
  record.systolic != null ||
  record.heartRate != null ||
  record.spo2 != null ||
  record.temperature != null;

export const mergeReportVitals = (
  patient: PatientData,
  records: PatientVitalSigns[]
): PatientData => {
  if (records.length === 0) return patient;
  // `records` arrive most-recent-first; keep ALL of them (past AND future), capped for doc size.
  const history = records.slice(0, MAX_VITALS_HISTORY);
  // The census cell shows the newest reading that carries a CORE vital (PA/FC/Sat/T°), so an HGT- or
  // insulin-only later measurement never leaves the cell blank. The full history (HGT/insulin rows
  // included) still feeds the detail modal.
  const glance = history.find(hasCoreVital) ?? history[0];
  return { ...patient, vitalSigns: glance, vitalSignsHistory: history };
};
