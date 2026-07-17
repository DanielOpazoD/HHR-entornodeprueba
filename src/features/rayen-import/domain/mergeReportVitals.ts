/**
 * Merges the vital signs parsed from Ficha Médico into a patient's HHR record: `vitalSigns` (the
 * glance shown in the census cell) and `vitalSignsHistory` (the most-recent measurements, so the
 * detail view can show several days). Self-contained like `mergeReportScales`. Ficha Médico is the
 * source of truth, so it replaces both fields.
 *
 * Range: only measurements on or before the census day are synced. A late sync of a past census
 * must not leak future readings into that historical clinical snapshot.
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
  records: PatientVitalSigns[],
  censusIsoDay: string
): PatientData => {
  const eligible = records.filter(record => record.recordedDate <= censusIsoDay);
  if (eligible.length === 0) {
    const retainedHistory = (patient.vitalSignsHistory ?? [])
      .filter(record => record.recordedDate <= censusIsoDay)
      .slice(0, MAX_VITALS_HISTORY);
    const retainedGlance = retainedHistory.find(hasCoreVital) ?? retainedHistory[0];
    const existingGlanceIsValid =
      patient.vitalSigns != null && patient.vitalSigns.recordedDate <= censusIsoDay;
    if (
      retainedHistory.length === (patient.vitalSignsHistory?.length ?? 0) &&
      (patient.vitalSigns == null || existingGlanceIsValid)
    ) {
      return patient;
    }
    const sanitized = { ...patient, vitalSignsHistory: retainedHistory };
    if (retainedGlance) return { ...sanitized, vitalSigns: retainedGlance };
    delete sanitized.vitalSigns;
    return sanitized;
  }
  // `records` arrive most-recent-first; retain only readings available by the selected census day.
  const history = eligible.slice(0, MAX_VITALS_HISTORY);
  // The census cell shows the newest reading that carries a CORE vital (PA/FC/Sat/T°), so an HGT- or
  // insulin-only later measurement never leaves the cell blank. The full history (HGT/insulin rows
  // included) still feeds the detail modal.
  const glance = history.find(hasCoreVital) ?? history[0];
  return { ...patient, vitalSigns: glance, vitalSignsHistory: history };
};
