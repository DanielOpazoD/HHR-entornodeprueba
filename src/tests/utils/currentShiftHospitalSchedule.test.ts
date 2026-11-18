// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import { addCalendarDays } from '@/utils/clinicalDateUtils';
import { getCurrentShift, getShiftSchedule } from '@/utils/clinicalDayUtils';
import { clinicalWallClockToDate } from '@/utils/clinicalWallClock';

const originalTimezone = process.env.TZ;

const minuteBefore = (hhmm: string): string => {
  const minutes = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) - 1;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

describe.each([
  'UTC',
  'America/Santiago',
  'Pacific/Easter',
  'Pacific/Auckland',
  'Pacific/Pago_Pago',
  'Pacific/Kiritimati',
])('current shift on a device in %s', timezone => {
  afterEach(() => {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });

  it('changes shift at the census schedule hours, holidays included, every day of 2026', () => {
    process.env.TZ = timezone;
    for (let day = '2026-01-01'; day < '2027-01-01'; day = addCalendarDays(day, 1)) {
      const { dayStart, nightStart } = getShiftSchedule(day);
      const at = (hhmm: string) => getCurrentShift(clinicalWallClockToDate(day, hhmm));
      expect([day, at(minuteBefore(dayStart)), at(dayStart)]).toEqual([day, 'night', 'day']);
      expect([day, at(minuteBefore(nightStart)), at(nightStart)]).toEqual([day, 'day', 'night']);
    }
  });

  it('keeps the hospital weekday where the device is already on the next day', () => {
    process.env.TZ = timezone;
    // Friday 08:30 in Rapa Nui is Saturday morning in Auckland and Kiritimati: still a business day.
    expect(getCurrentShift(clinicalWallClockToDate('2026-09-04', '08:30'))).toBe('day');
    // Sunday 08:30 is Monday there: the weekend day shift has not started yet.
    expect(getCurrentShift(clinicalWallClockToDate('2026-09-06', '08:30'))).toBe('night');
  });
});
