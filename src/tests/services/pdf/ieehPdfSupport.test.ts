// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { calculateDaysOfStay } from '@/services/pdf/ieehPdfSupport';

describe('ieehPdfSupport.calculateDaysOfStay', () => {
  it('uses the official discharge stay rule for IEEH', () => {
    expect(calculateDaysOfStay('2026-01-23', '2026-01-26')).toBe(3);
    expect(calculateDaysOfStay('23-01-2026', '26-01-2026')).toBe(3);
  });

  it('counts same-day discharge as 1 day', () => {
    expect(calculateDaysOfStay('2026-01-23', '2026-01-23')).toBe(1);
  });

  it('returns 0 when chronology is invalid or missing', () => {
    expect(calculateDaysOfStay('2026-01-26', '2026-01-23')).toBe(0);
    expect(calculateDaysOfStay(undefined, '2026-01-23')).toBe(0);
  });
});
