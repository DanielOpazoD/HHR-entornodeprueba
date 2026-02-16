import { describe, expect, it } from 'vitest';
import { BEDS } from '@/constants';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  buildAddDischargeInput,
  buildAddTransferInput,
  buildDischargeAddCommandPayload,
  buildTransferCommandPayload,
} from '@/features/census/controllers/patientMovementCreationInputController';

describe('patientMovementCreationInputController', () => {
  it('builds discharge creation input with required movement dependencies', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    const payload = buildDischargeAddCommandPayload({
      status: 'Vivo',
      dischargeType: 'Domicilio (Habitual)',
      movementDate: '2025-01-02',
      target: 'mother',
    });
    const input = buildAddDischargeInput({
      record,
      bedId: 'R1',
      payload,
      bedsCatalog: BEDS,
      createEmptyPatient,
    });

    expect(input.record).toBe(record);
    expect(input.bedId).toBe('R1');
    expect(input.payload.status).toBe('Vivo');
    expect(input.payload.movementDate).toBe('2025-01-02');
    expect(input.payload.dischargeTarget).toBe('mother');
    expect(input.bedsCatalog).toBe(BEDS);
    expect(input.createEmptyPatient).toBe(createEmptyPatient);
  });

  it('builds transfer creation input with required movement dependencies', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    const payload = buildTransferCommandPayload({
      method: 'Ambulancia',
      center: 'Hospital Base',
      centerOther: '',
      escort: 'TENS',
      time: '10:00',
      movementDate: '2025-01-02',
    });
    const input = buildAddTransferInput({
      record,
      bedId: 'R2',
      payload,
      bedsCatalog: BEDS,
      createEmptyPatient,
    });

    expect(input.record).toBe(record);
    expect(input.bedId).toBe('R2');
    expect(input.payload.evacuationMethod).toBe('Ambulancia');
    expect(input.payload.receivingCenter).toBe('Hospital Base');
    expect(input.payload.transferEscort).toBe('TENS');
    expect(input.payload.time).toBe('10:00');
    expect(input.payload.movementDate).toBe('2025-01-02');
    expect(input.bedsCatalog).toBe(BEDS);
    expect(input.createEmptyPatient).toBe(createEmptyPatient);
  });
});
