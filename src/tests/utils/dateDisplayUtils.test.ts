import { describe, expect, it } from 'vitest';

import { formatDateTimeCL } from '@/utils/dateDisplayUtils';

describe('formatDateTimeCL', () => {
  it('returns the original input unchanged when it is not a parseable date', () => {
    expect(formatDateTimeCL('not-a-date')).toBe('not-a-date');
    expect(formatDateTimeCL('')).toBe('');
  });

  it('renders a 2-digit day/month, 4-digit year and a 24-hour time', () => {
    const formatted = formatDateTimeCL('2026-06-25T16:30:00');
    // Separators are locale-driven, but the 24h clock is pinned, so the time is
    // deterministic across runtimes.
    expect(formatted).toMatch(/\b25\b/);
    expect(formatted).toMatch(/\b06\b/);
    expect(formatted).toMatch(/\b2026\b/);
    expect(formatted).toContain('16:30');
    expect(formatted).not.toMatch(/[ap]\.?\s*m\.?/i);
  });
});
