// @vitest-environment node
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecordDateTimestamp } from '@/services/repositories/dailyRecordMetadataDomainService';
import {
  addCalendarDays as appAddCalendarDays,
  isCalendarDate as appIsCalendarDate,
} from '@/utils/clinicalDateUtils';

const require = createRequire(import.meta.url);
const {
  addCalendarDays,
  calendarDayAtUtcNoon,
  hospitalCalendarDay,
  hospitalDayStart,
  isCalendarDay,
} = require('../../../functions/lib/hospitalCalendarDay.js');
const { isCurrentRapaNuiDay } = require('../../../functions/lib/specialtyRules.js');
const instants = [
  ['2026-10-25T03:30:00.000Z', '2026-10-24'],
  ['2026-07-02T05:30:00.000Z', '2026-07-01'],
  ['2026-10-25T05:30:00.000Z', '2026-10-25'],
  ['2026-10-25T04:59:59.999Z', '2026-10-24'],
  ['2026-10-25T05:00:00.000Z', '2026-10-25'],
  ['2027-01-01T02:00:00.000Z', '2026-12-31'],
];

afterEach(() => vi.useRealTimers());

describe('hospital calendar day', () => {
  it.each(instants)('formats %s as %s using the IANA summer/winter offset', (instant, expected) => {
    const date = new Date(instant);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Easter',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const calendar = Object.fromEntries(parts.map(part => [part.type, part.value]));
    expect(`${calendar.year}-${calendar.month}-${calendar.day}`).toBe(expected);
    expect(hospitalCalendarDay(date)).toBe(expected);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(date);
    expect(hospitalCalendarDay()).toBe(expected);
  });

  it('preserves the former specialty clock for every hour across a year and both DST changes', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Pacific/Easter',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    for (
      let ms = Date.parse('2026-01-01T00:00Z');
      ms <= Date.parse('2027-01-01T06:00Z');
      ms += 3_600_000
    ) {
      const instant = new Date(ms);
      vi.setSystemTime(instant);
      const calendar = Object.fromEntries(
        formatter.formatToParts(instant).map(part => [part.type, part.value])
      );
      const legacyDay = `${calendar.year}-${calendar.month}-${calendar.day}`;
      expect(hospitalCalendarDay(instant)).toBe(legacyDay);
      expect(isCurrentRapaNuiDay(legacyDay)).toBe(true);
      expect(isCurrentRapaNuiDay('1900-01-01')).toBe(false);
    }
  });

  it('starts every day, both DST changes included, at the midnight new census days store', () => {
    for (
      let ms = Date.parse('2026-01-01T12:00Z');
      ms <= Date.parse('2027-01-01T12:00Z');
      ms += 86_400_000
    ) {
      const day = new Date(ms).toISOString().slice(0, 10);
      const start = hospitalDayStart(day);
      expect(hospitalCalendarDay(new Date(start))).toBe(day);
      expect(hospitalCalendarDay(new Date(start - 1))).not.toBe(day);
      expect(start).toBe(createRecordDateTimestamp(day));
    }
  });

  it.each(['2026-02-30', '2026-13-01', '13-05-2026', ''])('has no start for %j', day => {
    expect(hospitalDayStart(day)).toBeNaN();
  });
});

describe('server calendar-day helpers', () => {
  // The forms they replaced in the Functions libraries (W13-A1).
  const legacyValid = (value: unknown) =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T12:00:00Z')) &&
    new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
  const legacyCutoff = (today: string) => {
    const calendar = new Date(`${today}T12:00:00Z`);
    calendar.setUTCDate(calendar.getUTCDate() - 30);
    return [
      String(calendar.getUTCFullYear()).padStart(4, '0'),
      String(calendar.getUTCMonth() + 1).padStart(2, '0'),
      String(calendar.getUTCDate()).padStart(2, '0'),
    ].join('-');
  };

  it('match the app helpers and the replaced forms on every day of 2024-2028', () => {
    const mismatches: string[] = [];
    for (let ms = Date.UTC(2024, 0, 1, 12); ms <= Date.UTC(2028, 11, 31, 12); ms += 86_400_000) {
      const day = new Date(ms).toISOString().slice(0, 10);
      if (!isCalendarDay(day) || !appIsCalendarDate(day)) mismatches.push(`valid ${day}`);
      for (const days of [-30, -1, 1]) {
        if (addCalendarDays(day, days) !== appAddCalendarDays(day, days))
          mismatches.push(`shift ${day} ${days}`);
      }
      if (addCalendarDays(day, 1) !== new Date(ms + 86400000).toISOString().slice(0, 10))
        mismatches.push(`next ${day}`);
      if (addCalendarDays(day, -30) !== legacyCutoff(day)) mismatches.push(`cutoff ${day}`);
      if (calendarDayAtUtcNoon(day).getTime() !== ms) mismatches.push(`noon ${day}`);
    }
    expect(mismatches).toEqual([]);
  });

  it.each(['2026-02-30', '2026-02-29', '2026-13-01', '2026-1-5', '05-11-2026', '', null, 20261105])(
    'rejects %j exactly as the replaced validators did',
    value => {
      expect(isCalendarDay(value)).toBe(false);
      expect(legacyValid(value)).toBe(false);
    }
  );

  it('reads an impossible day leniently and an unreadable one as no day, as the full save did', () => {
    // The full save's previous-day lookup only skipped unreadable dates.
    expect(calendarDayAtUtcNoon('2026-02-30').getTime()).toBe(Date.parse('2026-03-02T12:00:00Z'));
    expect(calendarDayAtUtcNoon('invalid').getTime()).toBeNaN();
    expect(calendarDayAtUtcNoon(undefined).getTime()).toBeNaN();
  });

  it('throws on an unreadable day, as the replaced next-day arithmetic did', () => {
    expect(() => addCalendarDays('invalid', 1)).toThrow(RangeError);
    expect(() => new Date(Date.parse('invalid' + 'T12:00:00Z') + 86400000).toISOString()).toThrow(
      RangeError
    );
  });
});
