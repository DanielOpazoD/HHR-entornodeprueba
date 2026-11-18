// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import { CHILEAN_HOLIDAYS } from '@/utils/chileanHolidays';
import { addCalendarDays } from '@/utils/clinicalDateUtils';
import { getCurrentShift, getShiftSchedule } from '@/utils/clinicalDayUtils';
import { clinicalWallClockToDate } from '@/utils/clinicalWallClock';

/*
 * The holidays each year must have by law (sources in the header of `chileanHolidays.ts`). The
 * solstice and the election days are not computable here, so they are written with their source.
 */
const WINTER_SOLSTICE_DAY: Readonly<Record<number, string>> = {
  // Ley 21.357; day of the June solstice in continental Chile, as published on feriados.cl.
  2024: '06-20',
  2025: '06-20',
  2026: '06-21',
  2027: '06-21',
  2028: '06-20',
};
const ELECTION_DAYS: ReadonlySet<string> = new Set([
  '2024-06-09', // primaries: Ley 20.640 art. 6 with Ley 18.700 art. 180.
  '2024-10-27', // municipal and regional elections: only the Sunday is a holiday (Ley 21.693).
]);

const weekday = (date: string): number => new Date(`${date}T12:00:00Z`).getUTCDay();
const pad = (value: number): string => String(value).padStart(2, '0');

const easterSunday = (year: number): string => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((8 * b + 13) / 25) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
};

// Ley 19.668: Tuesday to Thursday move to that week's Monday, Friday to the next Monday.
const movedToMonday = (date: string): string => {
  const day = weekday(date);
  if (day >= 2 && day <= 4) return addCalendarDays(date, 1 - day);
  return day === 5 ? addCalendarDays(date, 3) : date;
};

// Ley 20.299: Tuesday moves to the previous Friday, Wednesday to that week's Friday.
const reformationDay = (year: number): string => {
  const date = `${year}-10-31`;
  const day = weekday(date);
  if (day === 2) return addCalendarDays(date, -4);
  return day === 3 ? addCalendarDays(date, 2) : date;
};

const legalHolidays = (year: number): string[] => {
  const solstice = WINTER_SOLSTICE_DAY[year];
  if (!solstice) throw new Error(`Write the ${year} winter solstice day (Ley 21.357) first.`);
  const easter = easterSunday(year);
  const independence = `${year}-09-18`;
  const days = [
    `${year}-01-01`,
    addCalendarDays(easter, -2),
    addCalendarDays(easter, -1),
    `${year}-05-01`,
    `${year}-05-21`,
    `${year}-${solstice}`,
    movedToMonday(`${year}-06-29`),
    `${year}-07-16`,
    `${year}-08-15`,
    independence,
    `${year}-09-19`,
    movedToMonday(`${year}-10-12`),
    reformationDay(year),
    `${year}-11-01`,
    `${year}-12-08`,
    `${year}-12-25`,
  ];
  if (weekday(`${year}-01-01`) === 0) days.push(`${year}-01-02`); // Ley 20.983
  if (weekday(independence) === 6) days.push(`${year}-09-17`); // Ley 20.983
  if (weekday(independence) === 2) days.push(`${year}-09-17`); // Código del Trabajo, art. 35 ter
  if (weekday(independence) === 3) days.push(`${year}-09-20`); // Código del Trabajo, art. 35 ter
  return [...new Set(days)].sort();
};

const listedYears = [...new Set(CHILEAN_HOLIDAYS.map(date => Number(date.slice(0, 4))))];

describe('Chilean holiday calendar', () => {
  it('is sorted and without repeated dates', () => {
    expect([...new Set(CHILEAN_HOLIDAYS)].sort()).toEqual([...CHILEAN_HOLIDAYS]);
  });

  it.each(listedYears)('lists exactly the legal holidays of %i', year => {
    const listed = CHILEAN_HOLIDAYS.filter(date => date.startsWith(`${year}-`));
    expect(listed.filter(date => !ELECTION_DAYS.has(date))).toEqual(legalHolidays(year));
  });
});

const originalTimezone = process.env.TZ;

// Dates this calendar had wrong, with the shift a nurse sees at 08:30 on the Rapa Nui clock.
const CORRECTED_DAYS: ReadonlyArray<readonly [string, 'day' | 'night']> = [
  ['2025-06-30', 'day'], // San Pedro y San Pablo fell on Sunday 29 June: it does not move.
  ['2025-10-13', 'day'], // Encuentro de Dos Mundos fell on Sunday 12 October.
  ['2026-11-02', 'day'], // no law makes 2 November a holiday.
  ['2027-08-16', 'day'], // Asunción does not move from Sunday 15 August.
  ['2027-09-17', 'night'], // Ley 20.983: 18 and 19 September fall on the weekend.
  ['2027-09-20', 'day'],
  ['2028-05-22', 'day'], // Glorias Navales does not move from Sunday 21 May.
  ['2028-06-26', 'night'], // Thursday 29 June moves to Monday 26 June.
  ['2028-06-29', 'day'],
  ['2028-07-17', 'day'], // Virgen del Carmen does not move from Sunday 16 July.
  ['2028-10-09', 'night'], // Thursday 12 October moves to Monday 9 October.
  ['2028-10-12', 'day'],
  ['2028-10-27', 'night'], // Tuesday 31 October moves to Friday 27 October.
  ['2028-10-31', 'day'],
];

describe.each([
  'UTC',
  'America/Santiago',
  'Pacific/Easter',
  'Pacific/Auckland',
  'Pacific/Kiritimati',
])('shift on a corrected date, on a device in %s', timezone => {
  afterEach(() => {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });

  it.each(CORRECTED_DAYS)('%s at 08:30 in Rapa Nui is the %s shift', (date, shift) => {
    process.env.TZ = timezone;
    const dayStart = shift === 'day' ? '08:00' : '09:00';
    expect(getShiftSchedule(date).dayStart).toBe(dayStart);
    expect(getShiftSchedule(addCalendarDays(date, -1)).nightEnd).toBe(dayStart);
    expect(getCurrentShift(clinicalWallClockToDate(date, '08:30'))).toBe(shift);
  });
});
