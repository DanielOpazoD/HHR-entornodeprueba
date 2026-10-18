// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { reportPredatesAdmission } from '@/features/rayen-import/domain/egresoReportPolicy';

describe('official discharge chronology compares calendar dates, not census labels', () => {
  it.each([
    [
      'daytime admission before following midnight',
      '2026-08-15',
      '00:19',
      '2026-08-15',
      '10:00',
      false,
    ],
    [
      'midnight admission before later midnight discharge',
      '2026-08-15',
      '00:19',
      '2026-08-16',
      '00:10',
      false,
    ],
    [
      'genuinely earlier discharge on same calendar night',
      '2026-08-15',
      '00:19',
      '2026-08-16',
      '00:30',
      true,
    ],
    ['readmission the following day', '2026-08-15', '18:30', '2026-08-16', '10:00', true],
    [
      'daytime discharge before same-day admission',
      '2026-08-15',
      '10:00',
      '2026-08-15',
      '11:00',
      true,
    ],
    ['month rollover', '2026-08-31', '01:00', '2026-09-01', '00:30', false],
    ['year rollover', '2026-12-31', '01:00', '2027-01-01', '01:30', true],
    ['before old handoff boundary', '2026-10-09', '08:59', '2026-10-10', '08:30', false],
    ['at old handoff boundary', '2026-10-09', '09:00', '2026-10-10', '08:30', true],
    ['before new handoff boundary', '2026-10-12', '07:59', '2026-10-13', '07:30', false],
    ['at new handoff boundary', '2026-10-12', '08:00', '2026-10-13', '07:30', true],
  ])('%s', (_label, iso, hhmm, admissionDate, admissionTime, expected) => {
    expect(reportPredatesAdmission({ iso, hhmm }, { admissionDate, admissionTime })).toBe(expected);
  });
});
