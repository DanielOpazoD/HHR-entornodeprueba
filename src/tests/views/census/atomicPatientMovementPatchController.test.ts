import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { buildAtomicPatientMovementPatch } from '@/features/census/controllers/atomicPatientMovementPatchController';

describe('atomicPatientMovementPatchController', () => {
  it('builds one patch with CMA list and source bed update', () => {
    const currentRecord = DataFactory.createMockDailyRecord('2025-01-01');
    currentRecord.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente CMA',
      rut: '11-1',
      location: 'Sector A',
    });
    const cma = [DataFactory.createMockCMA({ id: 'cma-1', originalBedId: 'R1' })];
    const updatedRecord = {
      ...currentRecord,
      cma,
      beds: {
        ...currentRecord.beds,
        R1: DataFactory.createMockPatient('R1', {
          patientName: '',
          rut: '',
          location: 'Sector A',
        }),
      },
    };

    const patch = buildAtomicPatientMovementPatch({
      updatedRecord,
      movementKey: 'cma',
      sourceBedIds: ['R1'],
    });

    expect(patch).toEqual({
      cma,
      'beds.R1': updatedRecord.beds.R1,
    });
  });

  it('builds one patch with discharges and only touched source beds', () => {
    const currentRecord = DataFactory.createMockDailyRecord('2025-01-01');
    const discharges = [DataFactory.createMockDischarge({ id: 'discharge-1' })];
    const updatedRecord = {
      ...currentRecord,
      discharges,
      beds: {
        ...currentRecord.beds,
        R1: DataFactory.createMockPatient('R1', { patientName: '' }),
      },
    };

    const patch = buildAtomicPatientMovementPatch({
      updatedRecord,
      movementKey: 'discharges',
      sourceBedIds: ['R1'],
    });

    expect(patch).toEqual({
      discharges,
      'beds.R1': updatedRecord.beds.R1,
    });
    expect(patch).not.toHaveProperty('beds.R2');
  });

  it('builds one patch with transfers and source bed update', () => {
    const currentRecord = DataFactory.createMockDailyRecord('2025-01-01');
    const transfers = [DataFactory.createMockTransfer({ id: 'transfer-1' })];
    const updatedRecord = {
      ...currentRecord,
      transfers,
      beds: {
        ...currentRecord.beds,
        R1: DataFactory.createMockPatient('R1', { patientName: '' }),
      },
    };

    const patch = buildAtomicPatientMovementPatch({
      updatedRecord,
      movementKey: 'transfers',
      sourceBedIds: ['R1'],
    });

    expect(patch).toEqual({
      transfers,
      'beds.R1': updatedRecord.beds.R1,
    });
  });
});
