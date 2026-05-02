import { describe, expect, it } from 'vitest';

import { resolveAuditDateRangePreset } from '@/services/admin/auditDateRangePresets';

describe('resolveAuditDateRangePreset', () => {
  const now = new Date(2026, 4, 2, 12, 0, 0);

  it('resolves the current month from the first day to today', () => {
    expect(resolveAuditDateRangePreset('current_month', now)).toEqual({
      startDate: '2026-05-01',
      endDate: '2026-05-02',
    });
  });

  it('resolves the last three months from the first day of the first included month to today', () => {
    expect(resolveAuditDateRangePreset('last_3_months', now)).toEqual({
      startDate: '2026-03-01',
      endDate: '2026-05-02',
    });
  });

  it('resolves the current year from January first to today', () => {
    expect(resolveAuditDateRangePreset('current_year', now)).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-05-02',
    });
  });

  it('clears the range for full history', () => {
    expect(resolveAuditDateRangePreset('all', now)).toEqual({
      startDate: '',
      endDate: '',
    });
  });
});
