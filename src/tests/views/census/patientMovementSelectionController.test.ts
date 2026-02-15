import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  selectDischargeUndoMovement,
  selectTransferUndoMovement,
} from '@/features/census/controllers/patientMovementSelectionController';

describe('patientMovementSelectionController', () => {
  it('selects discharge movement by id', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    record.discharges = [
      DataFactory.createMockDischarge({ id: 'd-1', patientName: 'Paciente Alta' }),
    ];

    const movement = selectDischargeUndoMovement(record, 'd-1');

    expect(movement?.id).toBe('d-1');
    expect(movement?.patientName).toBe('Paciente Alta');
  });

  it('returns undefined when discharge movement does not exist', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');

    const movement = selectDischargeUndoMovement(record, 'missing');

    expect(movement).toBeUndefined();
  });

  it('selects transfer movement by id', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    record.transfers = [
      DataFactory.createMockTransfer({ id: 't-1', patientName: 'Paciente Traslado' }),
    ];

    const movement = selectTransferUndoMovement(record, 't-1');

    expect(movement?.id).toBe('t-1');
    expect(movement?.patientName).toBe('Paciente Traslado');
  });

  it('returns undefined when transfer movement does not exist', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');

    const movement = selectTransferUndoMovement(record, 'missing');

    expect(movement).toBeUndefined();
  });
});
