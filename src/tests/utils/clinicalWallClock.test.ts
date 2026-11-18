// @vitest-environment node
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import {
  clinicalWallClockToDate,
  hasNurseEditingWindowClosed,
  isWithinNurseEditingWindow,
  nurseEditingWindowClosesAt,
} from '@/utils/clinicalWallClock';

const require = createRequire(import.meta.url);
const { hospitalDayStart } = require('../../../functions/lib/hospitalCalendarDay.js');
const { assertNursePatchWindow } = require('../../../functions/lib/dailyRecordWritePolicy.js');

const DAY_MS = 86_400_000;
const originalTimezone = process.env.TZ;

describe('clinical wall clock', () => {
  it.each([
    ['2026-03-03', '08:00', '2026-03-03T13:00:00.000Z'], // summer time, UTC-5
    ['2026-07-15', '08:00', '2026-07-15T14:00:00.000Z'], // winter time, UTC-6
    ['2026-04-04', '08:00', '2026-04-04T13:00:00.000Z'], // clocks go back that night
    ['2026-04-05', '08:00', '2026-04-05T14:00:00.000Z'],
    ['2026-09-05', '08:00', '2026-09-05T14:00:00.000Z'], // clocks go forward that night
    ['2026-09-06', '08:00', '2026-09-06T13:00:00.000Z'],
    ['2026-10-31', '23:30', '2026-11-01T04:30:00.000Z'], // already Nov 1 in UTC and Santiago
  ])('places %s %s on the hospital clock at %s', (isoDate, hhmm, instant) => {
    expect(clinicalWallClockToDate(isoDate, hhmm).toISOString()).toBe(instant);
  });

  it('round-trips every quarter hour of a day through the hospital clock', () => {
    for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
      const hhmm = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      expect(calendarStampInClinicalTimeZone(clinicalWallClockToDate('2026-03-03', hhmm))).toEqual({
        iso: '2026-03-03',
        hhmm,
      });
    }
  });

  it('resolves the hours touched by a clock change like the clocks did', () => {
    // 21:30 happens twice on Apr 4: the first occurrence wins.
    expect(clinicalWallClockToDate('2026-04-04', '21:30').toISOString()).toBe(
      '2026-04-05T02:30:00.000Z'
    );
    // 22:30 does not exist on Sep 5: the clocks jumped from 22:00 to 23:00.
    expect(calendarStampInClinicalTimeZone(clinicalWallClockToDate('2026-09-05', '22:30'))).toEqual(
      { iso: '2026-09-05', hhmm: '23:30' }
    );
  });
});

describe.each([
  'UTC',
  'America/Santiago',
  'Pacific/Easter',
  'Pacific/Auckland',
  'Pacific/Pago_Pago',
  'Pacific/Kiritimati',
])('nurse editing window on a device in %s', timezone => {
  afterEach(() => {
    vi.restoreAllMocks();
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });

  const serverAllowsNurse = (date: string, now: number): boolean => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      assertNursePatchWindow({ date, role: 'nurse_hospital' });
      return true;
    } catch {
      return false;
    }
  };

  it('opens and closes at the same instants as the daily-record functions for every day of 2026', () => {
    process.env.TZ = timezone;
    // From 24 h before to 48 h after the day's Rapa Nui midnight, both ends excluded. It has
    // closed only from its end on; before it opens it has not closed.
    const boundaries: [number, boolean, boolean][] = [
      [-DAY_MS - 1, false, false],
      [-DAY_MS, false, false],
      [-DAY_MS + 1, true, false],
      [2 * DAY_MS - 1, true, false],
      [2 * DAY_MS, false, true],
    ];
    for (let index = 0; index < 365; index += 1) {
      const day = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
      const midnight = hospitalDayStart(day);
      expect(clinicalWallClockToDate(day, '00:00').getTime(), day).toBe(midnight);
      for (const [offset, open, closed] of boundaries) {
        const now = midnight + offset;
        expect(isWithinNurseEditingWindow(day, now), `${day} ${offset}`).toBe(open);
        expect(hasNurseEditingWindowClosed(day, now), `${day} ${offset}`).toBe(closed);
        expect(serverAllowsNurse(day, now), `${day} ${offset}`).toBe(open);
      }
    }
  });

  it('reports the closing instant as the first one the server refuses, for every day of 2026', () => {
    process.env.TZ = timezone;
    for (let index = 0; index < 365; index += 1) {
      const day = new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
      const closesAt = nurseEditingWindowClosesAt(day);
      expect(closesAt, day).toBe(hospitalDayStart(day) + 2 * DAY_MS);
      expect(serverAllowsNurse(day, (closesAt ?? 0) - 1), day).toBe(true);
      expect(serverAllowsNurse(day, closesAt ?? 0), day).toBe(false);
    }
  });

  it('keeps a malformed day outside the window, as the server does, and never closed', () => {
    process.env.TZ = timezone;
    const now = Date.parse('2026-11-17T12:00:00.000Z');
    for (const day of ['', '2026-11-17T00:00', '17-11-2026', '2026-02-30', '2026-13-01']) {
      expect(isWithinNurseEditingWindow(day, now), day).toBe(false);
      expect(hasNurseEditingWindowClosed(day, now), day).toBe(false);
      expect(nurseEditingWindowClosesAt(day), day).toBeNull();
      expect(serverAllowsNurse(day, now), day).toBe(false);
    }
  });
});
