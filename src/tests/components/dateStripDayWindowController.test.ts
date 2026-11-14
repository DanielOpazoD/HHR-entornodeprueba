import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveDateStripDayWindow,
  resolveDateStripVisibleDays,
  resolveIsFutureDayBlocked,
} from '@/components/layout/date-strip/dateStripDayWindowController';

describe('dateStripDayWindowController', () => {
  it('resolves visible days by viewport width', () => {
    expect(resolveDateStripVisibleDays(375)).toBe(5);
    expect(resolveDateStripVisibleDays(900)).toBe(7);
    expect(resolveDateStripVisibleDays(768, 'CENSUS')).toBe(3);
    expect(resolveDateStripVisibleDays(1280)).toBe(13);
    expect(resolveDateStripVisibleDays(1280, 'CENSUS')).toBe(9);
    expect(resolveDateStripVisibleDays(1280, 'NURSING_HANDOFF')).toBe(9);
    expect(resolveDateStripVisibleDays(1280, 'MEDICAL_HANDOFF')).toBe(9);
  });

  it('centers selected day and clamps to month boundaries', () => {
    expect(
      resolveDateStripDayWindow({
        selectedDay: 1,
        daysInMonth: 31,
        windowWidth: 1280,
      })
    ).toEqual({ startDay: 1, endDay: 13, visibleDays: 13 });

    expect(
      resolveDateStripDayWindow({
        selectedDay: 31,
        daysInMonth: 31,
        windowWidth: 1280,
      })
    ).toEqual({ startDay: 19, endDay: 31, visibleDays: 13 });

    expect(
      resolveDateStripDayWindow({
        selectedDay: 19,
        daysInMonth: 31,
        windowWidth: 1280,
        currentModule: 'CENSUS',
      })
    ).toEqual({ startDay: 15, endDay: 23, visibleDays: 9 });
  });

  it('blocks only dates after tomorrow, across month and year ends', () => {
    const referenceDay = '2026-02-15';

    expect(
      resolveIsFutureDayBlocked({
        selectedYear: 2026,
        selectedMonth: 1,
        day: 16,
        referenceDay,
      })
    ).toBe(false);

    expect(
      resolveIsFutureDayBlocked({
        selectedYear: 2026,
        selectedMonth: 1,
        day: 17,
        referenceDay,
      })
    ).toBe(true);

    const blocked = (selectedYear: number, selectedMonth: number, day: number) =>
      resolveIsFutureDayBlocked({ selectedYear, selectedMonth, day, referenceDay: '2026-12-31' });
    expect(blocked(2026, 11, 31)).toBe(false);
    expect(blocked(2027, 0, 1)).toBe(false);
    expect(blocked(2027, 0, 2)).toBe(true);
  });
});

describe('resolveIsFutureDayBlocked on a device far from the hospital zone', () => {
  const deviceZone = process.env.TZ;
  afterEach(() => {
    if (deviceZone === undefined) delete process.env.TZ;
    else process.env.TZ = deviceZone;
  });

  it.each(['Pacific/Auckland', 'Pacific/Pago_Pago', 'Pacific/Easter'])(
    'keeps tomorrow selectable and blocks the day after on a device in %s',
    zone => {
      process.env.TZ = zone;
      const at = (day: number) =>
        resolveIsFutureDayBlocked({
          selectedYear: 2026,
          selectedMonth: 10,
          day,
          referenceDay: '2026-11-12',
        });
      expect(at(12)).toBe(false);
      expect(at(13)).toBe(false);
      expect(at(14)).toBe(true);
    }
  );
});
