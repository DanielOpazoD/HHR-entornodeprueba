import { describe, expect, it } from 'vitest';
import { BEDS } from '@/constants';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  buildAddDischargeInput,
  buildAddTransferInput,
} from '@/features/census/controllers/patientMovementCreationInputController';

describe('patientMovementCreationInputController', () => {
  it('builds discharge creation input with required movement dependencies', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    const input = buildAddDischargeInput({
      record,
      bedId: 'R1',
      status: 'Vivo',
      dischargeType: 'Domicilio (Habitual)',
      movementDate: '2025-01-02',
      target: 'mother',
      bedsCatalog: BEDS,
      createEmptyPatient,
    });

    expect(input.record).toBe(record);
    expect(input.bedId).toBe('R1');
    expect(input.status).toBe('Vivo');
    expect(input.movementDate).toBe('2025-01-02');
    expect(input.target).toBe('mother');
    expect(input.bedsCatalog).toBe(BEDS);
    expect(input.createEmptyPatient).toBe(createEmptyPatient);
  });

  it('builds transfer creation input with required movement dependencies', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    const input = buildAddTransferInput({
      record,
      bedId: 'R2',
      method: 'Ambulancia',
      center: 'Hospital Base',
      centerOther: '',
      escort: 'TENS',
      time: '10:00',
      movementDate: '2025-01-02',
      bedsCatalog: BEDS,
      createEmptyPatient,
    });

    expect(input.record).toBe(record);
    expect(input.bedId).toBe('R2');
    expect(input.method).toBe('Ambulancia');
    expect(input.center).toBe('Hospital Base');
    expect(input.escort).toBe('TENS');
    expect(input.time).toBe('10:00');
    expect(input.movementDate).toBe('2025-01-02');
    expect(input.bedsCatalog).toBe(BEDS);
    expect(input.createEmptyPatient).toBe(createEmptyPatient);
  });
});
