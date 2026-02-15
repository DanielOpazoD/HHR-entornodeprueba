import { describe, expect, it } from 'vitest';
import {
  formatClockTimeHHMM,
  getCurrentClockTimeHHMM,
} from '@/features/census/controllers/censusClockController';

describe('censusClockController', () => {
  it('formats a Date object as HH:MM', () => {
    const date = new Date(2026, 1, 15, 5, 7, 0);

    expect(formatClockTimeHHMM(date)).toBe('05:07');
  });

  it('uses the provided date provider for deterministic current time', () => {
    const dateProvider = () => new Date(2026, 1, 15, 22, 3, 15);

    expect(getCurrentClockTimeHHMM(dateProvider)).toBe('22:03');
  });
});
