// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { calendarStampInClinicalTimeZone } from '@/utils/clinicalTimeZone';
import { clinicalWallClockToDate } from '@/utils/clinicalWallClock';

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
