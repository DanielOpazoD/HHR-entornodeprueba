import { describe, expect, it } from 'vitest';
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

  it('blocks only dates after tomorrow', () => {
    const referenceDate = new Date('2026-02-15T10:00:00.000Z');

    expect(
      resolveIsFutureDayBlocked({
        selectedYear: 2026,
        selectedMonth: 1,
        day: 16,
        referenceDate,
      })
    ).toBe(false);

    expect(
      resolveIsFutureDayBlocked({
        selectedYear: 2026,
        selectedMonth: 1,
        day: 17,
        referenceDate,
      })
    ).toBe(true);
  });
});
