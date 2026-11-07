import { describe, expect, it } from 'vitest';
import {
  censusLaboratoryDraftRange,
  censusLaboratoryPeriodProblem,
} from '@/features/laboratory/controllers/censusLaboratoryPeriod';

describe('census laboratory query period', () => {
  it('keeps the per-admission default separate from an explicit history window', () => {
    const dates = { from: '2026-01-01', to: '2026-11-07' };
    expect(censusLaboratoryDraftRange({ mode: 'admission', ...dates })).toBeUndefined();
    expect(censusLaboratoryDraftRange({ mode: 'custom', ...dates })).toEqual(dates);
    expect(censusLaboratoryPeriodProblem(dates, '2026-11-07')).toBeNull();
    expect(censusLaboratoryPeriodProblem({ from: dates.to, to: dates.to }, dates.to)).toBeNull();
  });

  it.each([
    { from: '', to: '2026-11-07' },
    { from: '2026-02-30', to: '2026-11-07' },
    { from: '2026-11-07', to: '2026-11-06' },
    { from: '2026-11-07', to: '2026-11-08' },
  ])('prevents an invalid, reversed or future range: %j', range => {
    expect(censusLaboratoryPeriodProblem(range, '2026-11-07')).not.toBeNull();
  });
});
