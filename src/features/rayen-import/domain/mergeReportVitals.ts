/**
 * Merges the vital signs parsed from Ficha Médico into a patient's HHR `vitalSigns` — the latest
 * measurement recorded on or before the census day being synced (see `latestVitalsAsOf`). Self-
 * contained like `mergeReportScales`. Ficha Médico is the source of truth, so it replaces the field.
 */

import type { PatientData } from '../contracts/rayenDomainContracts';
import type { PatientVitalSigns } from '@/types/domain/vitalSigns';
import { latestVitalsAsOf } from '../mapping/parseVitalSigns';

export interface MergeVitalsContext {
  /** The census day being synced (YYYY-MM-DD, Rapa Nui local). */
  censusIsoDay: string;
}

export const mergeReportVitals = (
  patient: PatientData,
  records: PatientVitalSigns[],
  ctx: MergeVitalsContext
): PatientData => {
  if (records.length === 0) return patient;
  const latest = latestVitalsAsOf(records, ctx.censusIsoDay);
  if (!latest) return patient;
  return { ...patient, vitalSigns: latest };
};
