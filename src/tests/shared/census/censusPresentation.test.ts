import { describe, expect, it } from 'vitest';
import {
  formatCensusIsoDate,
  formatCensusMonthName,
  formatCensusRouteDateLabel,
  formatCensusShortDayMonth,
} from '@/shared/census/censusPresentation';

describe('censusPresentation', () => {
  it('formats census ISO dates consistently', () => {
    expect(formatCensusIsoDate('2025-01-02')).toBe('02-01-2025');
    expect(formatCensusShortDayMonth('2025-01-02')).toBe('02-01');
    expect(formatCensusRouteDateLabel('2025-01-02')).toBe('02-01-2025');
  });

  it('builds a capitalized month label and tolerates invalid dates', () => {
    expect(formatCensusMonthName('2025-03-15')).toBe('Marzo');
    expect(formatCensusIsoDate('invalid-date')).toBe('invalid-date');
  });
});
