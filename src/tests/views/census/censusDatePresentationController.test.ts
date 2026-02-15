import { describe, expect, it } from 'vitest';
import { formatCensusHeaderDate } from '@/features/census/controllers/censusDatePresentationController';

describe('censusDatePresentationController', () => {
  it('formats ISO date for es-CL locale', () => {
    expect(formatCensusHeaderDate('2025-01-02')).toBe('02-01-2025');
  });

  it('returns input when date is invalid', () => {
    expect(formatCensusHeaderDate('invalid-date')).toBe('invalid-date');
  });
});
