import { describe, expect, it } from 'vitest';
import { hasStructuralRepairs, parseDailyRecordWithDefaultsReport } from '@/schemas/zodSchemas';

describe('zod daily record repair reports', () => {
  it('detects structural repairs in salvaged daily records', () => {
    const parsed = parseDailyRecordWithDefaultsReport(
      {
        date: '2026-03-04',
        beds: {
          R1: {
            patientName: 'Paciente Legacy',
            status: 'ESTADO_INVALIDO',
            clinicalEvents: [null],
          },
        },
      },
      '2026-03-04'
    );

    expect(hasStructuralRepairs(parsed.report)).toBe(true);
  });

  it('does not mark clean records as repaired', () => {
    const parsed = parseDailyRecordWithDefaultsReport(
      { date: '2026-03-04', beds: {}, nurses: ['', ''] },
      '2026-03-04'
    );

    expect(hasStructuralRepairs(parsed.report)).toBe(false);
  });
});
