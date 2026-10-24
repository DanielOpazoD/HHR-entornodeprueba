import { describe, expect, it, vi } from 'vitest';
import { validateAndSalvageRecord } from '@/services/repositories/helpers/validationHelper';

describe('validationHelper', () => {
  it('salvages legacy nulls and malformed beds instead of throwing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const record = validateAndSalvageRecord(
      {
        date: '2026-03-04',
        beds: {
          R1: {
            patientName: 'PACIENTE SINTETICO P5',
            status: 'ESTADO_INVALIDO',
            clinicalEvents: [
              {
                id: 'event-1',
                name: 'Cultivo',
                date: '2026-03-03',
                note: null,
                createdAt: '2026-03-03T10:00:00.000Z',
              },
            ],
          },
        },
        discharges: null,
      } as never,
      '2026-03-04'
    );

    expect(record.beds.R1.patientName).toBe('PACIENTE SINTETICO P5');
    expect(record.beds.R1.clinicalEvents).toEqual([
      {
        id: 'event-1',
        name: 'Cultivo',
        date: '2026-03-03',
        note: undefined,
        createdAt: '2026-03-03T10:00:00.000Z',
      },
    ]);
    expect(record.discharges).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some(([message]) =>
        String(message).includes('[RepositoryValidation] Strict validation failed for 2026-03-04')
      )
    ).toBe(true);

    warnSpy.mockRestore();
  });
});
