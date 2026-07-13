/**
 * Date helpers for the Rayen egreso-report range, extracted from useRayenImport to keep the hook
 * lean. Formatting is LOCAL (Rapa Nui) — toISOString() would shift to UTC and ask for the wrong day
 * from ~18:00 local onward.
 */

import type { DailyRecord } from '../contracts/rayenDomainContracts';

const pad = (n: number): string => String(n).padStart(2, '0');

/** The record's date as ISO YYYY-MM-DD for the egreso report range (accepts ISO or DD/MM/YYYY). */
export const toIsoReportDate = (record: DailyRecord): string => {
  const fromDate = (d: Date): string =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // Canonical source: the record's OWN day (its local-midnight timestamp), never "today" — this is
  // what makes a late sync of a PAST census still ask the report for that census day.
  if (typeof record.dateTimestamp === 'number' && !Number.isNaN(record.dateTimestamp)) {
    return fromDate(new Date(record.dateTimestamp));
  }
  const raw = (record.date ?? '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${pad(Number(dmy[2]))}-${pad(Number(dmy[1]))}`;
  return fromDate(new Date());
};

/** The ISO day after `iso` (YYYY-MM-DD), computed in UTC to avoid host-tz drift. */
export const nextIsoDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const next = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
};
