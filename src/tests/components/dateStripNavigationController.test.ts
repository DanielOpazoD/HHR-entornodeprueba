import { describe, expect, it } from 'vitest';
import {
  resolveShiftedMonthYear,
  resolveMonthLandingDay,
} from '@/components/layout/date-strip/dateStripNavigationController';

describe('dateStripNavigationController', () => {
  it('shifts months inside same year', () => {
    expect(resolveShiftedMonthYear({ month: 5, year: 2026, delta: 1 })).toEqual({
      month: 6,
      year: 2026,
    });
    expect(resolveShiftedMonthYear({ month: 5, year: 2026, delta: -1 })).toEqual({
      month: 4,
      year: 2026,
    });
  });

  it('handles year rollover forward and backward', () => {
    expect(resolveShiftedMonthYear({ month: 11, year: 2026, delta: 1 })).toEqual({
      month: 0,
      year: 2027,
    });
    expect(resolveShiftedMonthYear({ month: 0, year: 2026, delta: -1 })).toEqual({
      month: 11,
      year: 2025,
    });
  });

  it('supports deltas larger than one month', () => {
    expect(resolveShiftedMonthYear({ month: 10, year: 2026, delta: 3 })).toEqual({
      month: 1,
      year: 2027,
    });
    expect(resolveShiftedMonthYear({ month: 1, year: 2026, delta: -3 })).toEqual({
      month: 10,
      year: 2025,
    });
  });
});

it('lands CUDYR on the last calendar day of completed months, independent of missing census days', () => {
  const now = new Date('2026-10-08T18:00:00Z');
  expect(resolveMonthLandingDay(2026, 7, 'CUDYR', now)).toBe(31);
  expect(resolveMonthLandingDay(2026, 8, 'CUDYR', now)).toBe(30);
  expect(resolveMonthLandingDay(2024, 1, 'CUDYR', now)).toBe(29);
  expect(resolveMonthLandingDay(2026, 9, 'CUDYR', now)).toBe(8);
  expect(resolveMonthLandingDay(2026, 8, 'CENSUS', now)).toBe(1);
});
