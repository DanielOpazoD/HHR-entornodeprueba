// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  addCalendarDays,
  diffCalendarDays,
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

  it('adds and diffs calendar days across month boundaries', () => {
    expect(addCalendarDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addCalendarDays('2026-02-01', -1)).toBe('2026-01-31');
    expect(diffCalendarDays('2026-01-23', '2026-01-26')).toBe(3);
    expect(diffCalendarDays('invalid', '2026-01-26')).toBeNull();
  });
});
