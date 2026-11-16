// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildClearPatientPatch } from '@/hooks/useBedOperationsController';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

describe('useBedOperationsController', () => {
  it('builds a clear-patient patch preserving bed location', () => {
    const record = {
      date: '2026-03-17',
      beds: {
        B1: {
          bedId: 'B1',
          patientName: 'Paciente',
          location: 'Sala 1',
          isBlocked: false,
          bedMode: 'Cama',
          hasCompanionCrib: false,
        } as PatientData,
      },
      activeExtraBeds: [],
      discharges: [],
      transfers: [],
      cma: [],
      lastUpdated: '2026-03-17T00:00:00.000Z',
    } as DailyRecord;

    const result = buildClearPatientPatch(record, 'B1');

    expect(result.patch).toEqual({
      'beds.B1': expect.objectContaining({
        patientName: '',
        location: 'Sala 1',
      }),
    });
  });
});
