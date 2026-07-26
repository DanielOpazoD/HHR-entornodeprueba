/**
 * Parser for the official statistical discharge stamp printed by Gestión de Camas.
 *
 * Gestión de Camas prints report timestamps in the mainland Chile wall clock. HHR's census is
 * owned by Rapa Nui, so the value must be converted between named zones (including DST and day
 * rollover) rather than corrected with a fixed number of hours.
 */

import { resolveClinicalDayForDateTime } from '@/utils/clinicalDayAdmissionUtils';

export interface StatisticalEgresoStamp {
  /** HHR clinical census day (YYYY-MM-DD), after the 08:00/09:00 handoff rule. */
  iso: string;
  /** Rapa Nui calendar day before assigning the event to its nursing census. */
  calendarIso: string;
  /** Official statistical egreso time (HH:MM). */
  hhmm: string;
  /** Normalized official datetime (DD-MM-YYYY HH:MM). */
  text: string;
}

const pad2 = (value: number): string => String(value).padStart(2, '0');

const SOURCE_TIME_ZONE = 'America/Santiago';
const CENSUS_TIME_ZONE = 'Pacific/Easter';

interface DateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const partsInZone = (date: Date, timeZone: string): DateTimeParts => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find(part => part.type === type)?.value ?? 0);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
};

const mainlandWallClockInstant = (parts: DateTimeParts): Date => {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let instant = target;
  // Two passes cover DST offset changes without depending on the computer's local zone.
  for (let pass = 0; pass < 2; pass += 1) {
    const observed = partsInZone(new Date(instant), SOURCE_TIME_ZONE);
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute
    );
    instant += target - observedAsUtc;
  }
  return new Date(instant);
};

const stampFromInstant = (date: Date): StatisticalEgresoStamp | null => {
  if (Number.isNaN(date.getTime())) return null;
  const parts = partsInZone(date, CENSUS_TIME_ZONE);
  const calendarIso = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
  const hhmm = `${pad2(parts.hour)}:${pad2(parts.minute)}`;
  const iso = resolveClinicalDayForDateTime(calendarIso, hhmm) ?? calendarIso;
  return {
    iso,
    calendarIso,
    hhmm,
    text: `${pad2(parts.day)}-${pad2(parts.month)}-${parts.year} ${hhmm}`,
  };
};

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

  return stampFromInstant(mainlandWallClockInstant({ year, month, day, hour, minute }));
};

/** Converts an API timestamp carrying an explicit offset/UTC marker into the Rapa Nui census zone. */
export const parseStatisticalEgresoInstant = (value: string): StatisticalEgresoStamp | null => {
  const normalized = (value || '').trim();
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) return null;
  return stampFromInstant(new Date(normalized));
};
