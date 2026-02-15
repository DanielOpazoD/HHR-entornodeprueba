import { describe, expect, it } from 'vitest';
import {
  isValidHourMinute,
  resolveValidHourMinuteOrFallback,
} from '@/features/census/controllers/timeInputController';

describe('timeInputController', () => {
  it('validates canonical HH:mm values', () => {
    expect(isValidHourMinute('00:00')).toBe(true);
    expect(isValidHourMinute('23:59')).toBe(true);
    expect(isValidHourMinute(' 08:30 ')).toBe(true);
  });

  it('rejects malformed or out-of-range values', () => {
    expect(isValidHourMinute('24:00')).toBe(false);
    expect(isValidHourMinute('9:00')).toBe(false);
    expect(isValidHourMinute('10:60')).toBe(false);
    expect(isValidHourMinute(undefined)).toBe(false);
    expect(isValidHourMinute('')).toBe(false);
  });

  it('resolves valid time and falls back for invalid input', () => {
    expect(resolveValidHourMinuteOrFallback(' 10:15 ', '09:00')).toBe('10:15');
    expect(resolveValidHourMinuteOrFallback('25:10', '09:00')).toBe('09:00');
  });
});
