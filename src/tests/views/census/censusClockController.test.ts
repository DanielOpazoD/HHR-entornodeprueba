// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  formatClockTimeHHMM,
  getCurrentClockTimeHHMM,
} from '@/features/census/controllers/censusClockController';

describe('censusClockController', () => {
  it('formats a Date object as HH:MM', () => {
    const date = new Date('2026-02-15T10:07:00Z');

    expect(formatClockTimeHHMM(date)).toBe('05:07');
  });

  it('uses the provided date provider for deterministic current time', () => {
    const dateProvider = () => new Date('2026-02-16T03:03:15Z');

    expect(getCurrentClockTimeHHMM(dateProvider)).toBe('22:03');
  });
});
