// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildManualMedicalHandoffMessageModel } from '@/hooks/controllers/manualMedicalHandoffMessageController';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('manualMedicalHandoffMessageController', () => {
  it('builds a compact handoff summary model from visible beds', () => {
    const record = DataFactory.createMockDailyRecord('2026-02-15', {
      beds: {
        B1: DataFactory.createMockPatient('B1', { patientName: 'Paciente 1', isBlocked: false }),
        B2: DataFactory.createMockPatient('B2', { patientName: 'Bloqueada', isBlocked: true }),
      },
      medicalHandoffDoctor: 'Dr. Test',
    });

    const result = buildManualMedicalHandoffMessageModel(record, [
      { id: 'B1' },
      { id: 'B2' },
      { id: 'B3' },
    ]);

    expect(result).toEqual({
      hospitalized: 1,
      blockedBeds: 1,
      freeBeds: 1,
      formattedDate: '15-02-2026',
      doctorName: 'Dr. Test',
    });
  });

  it('falls back to default doctor label when not present', () => {
    const record = DataFactory.createMockDailyRecord('2026-02-15', {
      beds: {},
    });

    expect(buildManualMedicalHandoffMessageModel(record, []).doctorName).toBe('Sin especificar');
  });
});
