import { describe, expect, it } from 'vitest';
import {
  buildDayDateString,
  classifyDateStripDay,
} from '@/components/layout/date-strip/dateStripDayClassification';

describe('dateStripDayClassification', () => {
  it('builds a zero-padded YYYY-MM-DD from 0-based month parts', () => {
    expect(buildDayDateString(2026, 5, 9)).toBe('2026-06-09');
  });

  it('marks the clinical today, tracking the clinical day rather than the calendar date', () => {
    // Pre-rollover (e.g. 02:00 on the 29th) the clinical day is still the 28th.
    const classification = classifyDateStripDay({
      year: 2026,
      monthZeroBased: 5,
      day: 28,
      clinicalToday: '2026-06-28',
    });
    expect(classification.isClinicalToday).toBe(true);
    expect(classification.isBeforeClinicalToday).toBe(false);
  });

  it('flags a day before the clinical today', () => {
    const classification = classifyDateStripDay({
      year: 2026,
      monthZeroBased: 5,
      day: 27,
      clinicalToday: '2026-06-28',
    });
    expect(classification.isClinicalToday).toBe(false);
    expect(classification.isBeforeClinicalToday).toBe(true);
  });

  it('does not flag a day after the clinical today', () => {
    const classification = classifyDateStripDay({
      year: 2026,
      monthZeroBased: 5,
      day: 29,
      clinicalToday: '2026-06-28',
    });
    expect(classification.isClinicalToday).toBe(false);
    expect(classification.isBeforeClinicalToday).toBe(false);
  });
});
