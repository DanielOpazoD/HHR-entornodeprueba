/**
 * Date helpers for the Rayen egreso-report range, extracted from useRayenImport to keep the hook
 * lean. Formatting is LOCAL (Rapa Nui) — toISOString() would shift to UTC and ask for the wrong day
 * from ~18:00 local onward.
 */

import type { DailyRecord } from '../contracts/rayenDomainContracts';
import { isSupportedCensusSyncDay, type CensusSyncTarget } from '../domain/historicalCensusSync';

const pad = (n: number): string => String(n).padStart(2, '0');

/** The record's date as ISO YYYY-MM-DD for the egreso report range (accepts ISO or DD/MM/YYYY). */
export const toIsoReportDate = (record: DailyRecord): string => {
  const fromDate = (d: Date): string =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // Canonical source: the record's OWN day (its local-midnight timestamp), never "today" — this is
  // what makes a late sync of a PAST census still ask the report for that census day. Guard against a
  // non-finite timestamp (e.g. Infinity), which would yield an Invalid Date → "NaN-NaN-NaN".
  if (typeof record.dateTimestamp === 'number' && Number.isFinite(record.dateTimestamp)) {
    const fromTimestamp = new Date(record.dateTimestamp);
    if (!Number.isNaN(fromTimestamp.getTime())) return fromDate(fromTimestamp);
  }
  const raw = (record.date ?? '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
  // Fail loud rather than silently reconciling egresos for "today": a malformed census date is a
  // data bug, and syncing the wrong day would file discharges against the wrong record.
  throw new Error(`Fecha de censo inválida para la sincronización: "${record.date}"`);
};

/** The ISO day after `iso` (YYYY-MM-DD), computed in UTC to avoid host-tz drift. */
export const nextIsoDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const next = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
};

/** Administrative evidence spans the selected day through today's Rapa Nui calendar, inclusive. */
export const syncReportRange = (
  dateStart: string,
  target: CensusSyncTarget
): { dateStart: string; dateEnd: string } => {
  if (
    target.kind === 'unsupported' ||
    target.lookbackDays === null ||
    dateStart > target.clinicalDay
  ) {
    throw new Error('El intervalo administrativo solicitado no es válido.');
  }
  return { dateStart, dateEnd: nextIsoDay(target.calendarDay) };
};

/** Allows the live clinical day and the seven previous clinical days. */
export const toSyncReportDate = (record: DailyRecord, now: Date = new Date()): string => {
  const reportDate = toIsoReportDate(record);
  if (!isSupportedCensusSyncDay(reportDate, now)) {
    throw new Error(
      'La sincronización permite el censo vigente y hasta siete días clínicos anteriores. Para fechas más antiguas se requiere revisión manual.'
    );
  }
  return reportDate;
};

/** @deprecated Use toSyncReportDate. Kept for compatible imports while the feature migrates. */
export const toLiveSyncReportDate = toSyncReportDate;
