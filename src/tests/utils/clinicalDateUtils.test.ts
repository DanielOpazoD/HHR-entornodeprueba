// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';

import {
  addCalendarDays,
  calendarDayAtUtcNoon,
  diffCalendarDays,
  isCalendarDate,
  normalizeCalendarDate,
  normalizeDateOnly,
  parseCalendarDateUtcNoon,
} from '@/utils/clinicalDateUtils';

describe('clinicalDateUtils', () => {
  it('normalizes ISO datetime and Chilean calendar formats', () => {
    expect(normalizeDateOnly('2026-01-23T10:30:00Z')).toBe('2026-01-23');
    expect(normalizeCalendarDate('2026-01-23T10:30:00Z')).toBe('2026-01-23');
    expect(normalizeCalendarDate('23-01-2026')).toBe('2026-01-23');
    expect(normalizeCalendarDate('invalid')).toBeUndefined();
  });

  it('parses calendar dates at UTC noon and rejects invalid values', () => {
    expect(parseCalendarDateUtcNoon('2026-01-23')).toBe(Date.UTC(2026, 0, 23, 12, 0, 0));
    expect(parseCalendarDateUtcNoon('23-01-2026')).toBe(Date.UTC(2026, 0, 23, 12, 0, 0));
    expect(parseCalendarDateUtcNoon('invalid')).toBeNull();
  });

  it('takes years 0000–0099 as written and keeps the proleptic leap years', () => {
    expect(isCalendarDate('0005-01-01')).toBe(true);
    expect(isCalendarDate('0000-02-29')).toBe(true);
    expect(isCalendarDate('0048-02-29')).toBe(true);
    expect(isCalendarDate('0050-02-29')).toBe(false);
    expect(isCalendarDate('0100-02-29')).toBe(false);
    expect(isCalendarDate('1900-02-29')).toBe(false);
    expect(isCalendarDate('2000-02-29')).toBe(true);
    expect(isCalendarDate('0099-12-32')).toBe(false);
  });

  it('adds and diffs calendar days across month and year boundaries', () => {
    expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addCalendarDays('2026-02-01', -1)).toBe('2026-01-31');
    expect(diffCalendarDays('2026-01-23', '2026-01-26')).toBe(3);
    expect(diffCalendarDays('invalid', '2026-01-26')).toBeNull();
    expect(addCalendarDays('2024-12-31', 1)).toBe('2025-01-01');
    expect(addCalendarDays('2025-01-01', -1)).toBe('2024-12-31');
    expect(diffCalendarDays('2024-12-31', '2025-01-01')).toBe(1);
  });
});

describe('addCalendarDays across device time zones', () => {
  const deviceZone = process.env.TZ;
  afterEach(() => {
    if (deviceZone === undefined) delete process.env.TZ;
    else process.env.TZ = deviceZone;
  });

  // Auckland is ahead of UTC by more than twelve hours and Pago Pago behind by eleven: a day
  // label that passes through the device zone and back through UTC shifts in one of them.
  it.each(['Pacific/Auckland', 'Pacific/Pago_Pago', 'Pacific/Easter', 'America/Santiago', 'UTC'])(
    'shifts the calendar label the same way on a device in %s',
    zone => {
      process.env.TZ = zone;
      expect(addCalendarDays('2026-11-12', 1)).toBe('2026-11-13');
      expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28');
      expect(addCalendarDays('2026-09-05', 2)).toBe('2026-09-07');
      expect(addCalendarDays('2026-11-12', 0)).toBe('2026-11-12');
    }
  );
});

// The hand-written forms that `calendarDayAtUtcNoon`, `isCalendarDate` and `addCalendarDays`
// replaced (W13-A1), kept here as the reference each replacement must still equal.
const legacy = {
  noon: (day: string) => new Date(`${day}T12:00:00Z`).getTime(),
  valid: (day: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    Number.isFinite(Date.parse(day + 'T12:00:00Z')) &&
    new Date(day + 'T12:00:00Z').toISOString().slice(0, 10) === day,
  shift: (day: string, days: number) => {
    const date = new Date(`${day}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  },
  shiftByMs: (day: string, days: number) =>
    new Date(Date.parse(day + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10),
  span: (from: string, to: string) =>
    (Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000,
};

/** Every calendar day from 2024 to 2028: leap years, month and year ends, and the Pacific/Easter
 * changes of hour (first Sunday of April and of September) all fall inside. */
const everyDay = (() => {
  const days: string[] = [];
  for (let ms = Date.UTC(2024, 0, 1, 12); ms <= Date.UTC(2028, 11, 31, 12); ms += 86_400_000)
    days.push(new Date(ms).toISOString().slice(0, 10));
  return days;
})();
const impossibleOrMalformed = [
  '2026-02-29',
  '2026-02-30',
  '2026-04-31',
  '2026-13-01',
  '2026-00-10',
  '2026-1-5',
  '05-11-2026',
  '2026-11-05T10:00:00Z',
  '',
  'invalid',
];

describe('calendar-day helpers equal the hand-written anchors they replaced', () => {
  const deviceZone = process.env.TZ;
  afterEach(() => {
    if (deviceZone === undefined) delete process.env.TZ;
    else process.env.TZ = deviceZone;
  });

  it.each([
    'UTC',
    'America/Santiago',
    'Pacific/Easter',
    'Pacific/Auckland',
    'Pacific/Pago_Pago',
    'Pacific/Kiritimati',
  ])('on a device in %s', zone => {
    process.env.TZ = zone;
    const mismatches: string[] = [];
    for (const day of everyDay) {
      if (calendarDayAtUtcNoon(day).getTime() !== legacy.noon(day)) mismatches.push(`noon ${day}`);
      if (!isCalendarDate(day)) mismatches.push(`valid ${day}`);
      for (const days of [-365, -31, -1, 0, 1, 31]) {
        const shifted = addCalendarDays(day, days);
        if (shifted !== legacy.shift(day, days) || shifted !== legacy.shiftByMs(day, days))
          mismatches.push(`shift ${day} ${days}`);
        if (diffCalendarDays(day, shifted) !== legacy.span(day, shifted))
          mismatches.push(`span ${day} ${days}`);
      }
    }
    expect(mismatches).toEqual([]);
    for (const value of impossibleOrMalformed) {
      expect(isCalendarDate(value)).toBe(legacy.valid(value));
      expect(Number.isNaN(calendarDayAtUtcNoon(value).getTime())).toBe(
        Number.isNaN(legacy.noon(value))
      );
    }
  });

  it('keeps the Pacific/Easter change-of-hour days and their neighbours as plain calendar days', () => {
    expect(addCalendarDays('2026-04-04', 1)).toBe('2026-04-05');
    expect(addCalendarDays('2026-04-05', 1)).toBe('2026-04-06');
    expect(addCalendarDays('2026-09-06', -1)).toBe('2026-09-05');
    expect(addCalendarDays('2026-09-07', -1)).toBe('2026-09-06');
    expect(diffCalendarDays('2026-04-04', '2026-09-07')).toBe(156);
    expect(calendarDayAtUtcNoon('2026-09-06').getUTCDay()).toBe(0);
  });

  it('rejects impossible and malformed days, as each replaced validator did', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    for (const value of impossibleOrMalformed) expect(isCalendarDate(value)).toBe(false);
    // The lenient forms kept by fluid balance and the health panel still read 30 February as 2 March.
    expect(addCalendarDays('2026-02-30', 1)).toBe('2026-03-03');
  });
});
