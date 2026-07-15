/**
 * Parser for the official statistical discharge stamp printed by Gestión de Camas.
 *
 * Live evidence from the individual "Informe Estadístico de Egreso Hospitalario" and the
 * administrative-discharge API event confirms that the report already prints the Rapa Nui wall
 * clock. Therefore this parser NORMALIZES the value but never shifts it by timezone. The known D+1
 * workaround belongs only to the report search range; it must not alter the timestamp printed in a
 * row.
 */

export interface StatisticalEgresoStamp {
  /** Rapa Nui calendar day (YYYY-MM-DD). */
  iso: string;
  /** Official statistical egreso time (HH:MM). */
  hhmm: string;
  /** Normalized official datetime (DD-MM-YYYY HH:MM). */
  text: string;
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

export const parseStatisticalEgresoStamp = (fechaEgreso: string): StatisticalEgresoStamp | null => {
  const match = (fechaEgreso || '')
    .trim()
    .match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})[\sT]+(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const [, dd, mm, yyyy, hh, mi] = match;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  const hour = Number(hh);
  const minute = Number(mi);
  const calendarProbe = new Date(Date.UTC(year, month - 1, day));
  const isValid =
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    calendarProbe.getUTCFullYear() === year &&
    calendarProbe.getUTCMonth() === month - 1 &&
    calendarProbe.getUTCDate() === day;
  if (!isValid) return null;

  const iso = `${year}-${pad2(month)}-${pad2(day)}`;
  const hhmm = `${pad2(hour)}:${pad2(minute)}`;
  const text = `${pad2(day)}-${pad2(month)}-${year} ${hhmm}`;
  return { iso, hhmm, text };
};
