import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  resolveApplyUndoDischargeRecord,
  resolveApplyUndoTransferRecord,
} from '@/features/census/controllers/patientMovementUndoMutationController';

describe('patientMovementUndoMutationController', () => {
  it('applies undo for discharge by restoring bed and removing discharge entry', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01', {
      discharges: [
        DataFactory.createMockDischarge({ id: 'd-1', bedId: 'R1' }),
        DataFactory.createMockDischarge({ id: 'd-2', bedId: 'R2' }),
      ],
    });

    const updated = resolveApplyUndoDischargeRecord({
      record,
      dischargeId: 'd-1',
      bedId: 'R1',
      updatedBed: DataFactory.createMockPatient('R1', { patientName: 'Paciente Restaurado' }),
    });

    expect(updated.beds.R1.patientName).toBe('Paciente Restaurado');
    expect(updated.discharges.map(d => d.id)).toEqual(['d-2']);
  });

  it('applies undo for transfer by restoring bed and removing transfer entry', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01', {
      transfers: [
        DataFactory.createMockTransfer({ id: 't-1', bedId: 'R1' }),
        DataFactory.createMockTransfer({ id: 't-2', bedId: 'R2' }),
      ],
    });

    const updated = resolveApplyUndoTransferRecord({
      record,
      transferId: 't-2',
      bedId: 'R2',
      updatedBed: DataFactory.createMockPatient('R2', { patientName: 'Transfer Restaurado' }),
    });

    expect(updated.beds.R2.patientName).toBe('Transfer Restaurado');
    expect(updated.transfers.map(t => t.id)).toEqual(['t-1']);
  });
});
