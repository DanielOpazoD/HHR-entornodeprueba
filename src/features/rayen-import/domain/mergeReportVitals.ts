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
import { clinicalValuesEqual } from './clinicalIncrementalSync';

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

const vitalContentIdentity = (record: PatientVitalSigns): string =>
  JSON.stringify([
    record.recordedDate,
    record.recordedAt,
    record.systolic,
    record.diastolic,
    record.heartRate,
    record.spo2,
    record.temperature,
    record.respiratoryRate,
    record.painEva,
    record.hgt,
    record.insulinUnits,
    record.insulinQuadrant,
    record.observations,
    record.author,
    record.authorRole,
  ]);

const vitalStableIdentity = (record: PatientVitalSigns): string | null => {
  const sourceEventId = record.sourceEventId?.trim();
  return sourceEventId ? `event:${sourceEventId}` : null;
};

const vitalStorageIdentity = (record: PatientVitalSigns): string =>
  vitalStableIdentity(record) ?? `legacy:${vitalContentIdentity(record)}`;

const vitalOrder = (record: PatientVitalSigns): string =>
  `${record.recordedDate}|${record.recordedAt}|${record.sourceEventId?.padStart(20, '0') ?? ''}`;

const mergeVitalHistory = (
  existing: PatientVitalSigns[],
  incoming: PatientVitalSigns[],
  censusIsoDay: string
): PatientVitalSigns[] => {
  const byIdentity = new Map<string, PatientVitalSigns>();
  for (const record of existing) {
    if (record.recordedDate <= censusIsoDay) byIdentity.set(vitalStorageIdentity(record), record);
  }
  // Eloisa is authoritative for a stable source id: the incoming value replaces a previously
  // stored version even when a correction moves it outside the census day. When source ids are
  // introduced over legacy content, remove the content-identical fallback to avoid one migration
  // duplicate.
  for (const record of incoming) {
    const stableIdentity = vitalStableIdentity(record);
    if (stableIdentity) {
      byIdentity.delete(stableIdentity);
      byIdentity.delete(`legacy:${vitalContentIdentity(record)}`);
    }
    if (record.recordedDate <= censusIsoDay) {
      byIdentity.set(stableIdentity ?? vitalStorageIdentity(record), record);
    }
  }
  return [...byIdentity.values()]
    .sort((left, right) => vitalOrder(right).localeCompare(vitalOrder(left)))
    .slice(0, MAX_VITALS_HISTORY);
};

export const mergeReportVitals = (
  patient: PatientData,
  records: PatientVitalSigns[],
  censusIsoDay: string
): PatientData => {
  const history = mergeVitalHistory(
    [...(patient.vitalSignsHistory ?? []), ...(patient.vitalSigns ? [patient.vitalSigns] : [])],
    records,
    censusIsoDay
  );
  // The census cell shows the newest reading that carries a CORE vital (PA/FC/Sat/T°), so an HGT- or
  // insulin-only later measurement never leaves the cell blank. The full history (HGT/insulin rows
  // included) still feeds the detail modal.
  const glance = history.find(hasCoreVital) ?? history[0];
  const nextHistory = history.length > 0 ? history : [];
  if (
    clinicalValuesEqual(patient.vitalSignsHistory ?? [], nextHistory) &&
    clinicalValuesEqual(patient.vitalSigns, glance)
  ) {
    return patient;
  }
  const merged = { ...patient, vitalSignsHistory: nextHistory };
  if (glance) return { ...merged, vitalSigns: glance };
  delete merged.vitalSigns;
  return merged;
};
