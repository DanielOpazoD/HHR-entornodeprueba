import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { BEDS } from '@/constants';
import { createEmptyPatient } from '@/services/factories/patientFactory';
import {
  resolveAddDischargeMovement,
  resolveAddTransferMovement,
} from '@/features/census/controllers/patientMovementCreationController';

describe('patientMovementCreationController', () => {
  it('fails discharge creation when source bed is empty', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    const result = resolveAddDischargeMovement({
      record,
      bedId: 'R1',
      payload: {
        status: 'Vivo',
        time: '',
        dischargeTarget: 'both',
      },
      bedsCatalog: BEDS,
      createEmptyPatient,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('SOURCE_BED_EMPTY');
    }
  });

  it('creates mother+baby discharges and clears bed', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Madre A',
      rut: '11-1',
      clinicalCrib: DataFactory.createMockPatient('R1', {
        patientName: 'RN A',
        rut: '22-2',
      }),
    });

    const result = resolveAddDischargeMovement({
      record,
      bedId: 'R1',
      payload: {
        status: 'Vivo',
        cribStatus: 'Vivo',
        time: '',
        dischargeTarget: 'both',
      },
      bedsCatalog: BEDS,
      createEmptyPatient,
      createId: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.updatedRecord.discharges).toHaveLength(2);
      expect(result.value.updatedRecord.beds.R1.patientName).toBe('');
      expect(result.value.auditEntries).toHaveLength(2);
    }
  });

  it('promotes clinical crib when discharge target is mother', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Madre A',
      clinicalCrib: DataFactory.createMockPatient('R1', {
        patientName: 'RN A',
      }),
    });

    const result = resolveAddDischargeMovement({
      record,
      bedId: 'R1',
      payload: {
        status: 'Vivo',
        time: '',
        dischargeTarget: 'mother',
      },
      bedsCatalog: BEDS,
      createEmptyPatient,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.updatedRecord.beds.R1.patientName).toBe('RN A');
      expect(result.value.updatedRecord.beds.R1.clinicalCrib).toBeUndefined();
    }
  });

  it('creates transfer entries for mother and clinical crib and clears bed', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Madre A',
      rut: '11-1',
      clinicalCrib: DataFactory.createMockPatient('R1', {
        patientName: 'RN A',
        rut: '22-2',
      }),
    });

    const result = resolveAddTransferMovement({
      record,
      bedId: 'R1',
      payload: {
        evacuationMethod: 'Ambulancia',
        receivingCenter: 'Hospital Base',
        receivingCenterOther: '',
        transferEscort: '',
        time: '',
      },
      bedsCatalog: BEDS,
      createEmptyPatient,
      createId: (() => {
        let n = 0;
        return () => `id-${++n}`;
      })(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.updatedRecord.transfers).toHaveLength(2);
      expect(result.value.updatedRecord.beds.R1.patientName).toBe('');
      expect(result.value.auditEntry.patientName).toBe('Madre A');
    }
  });

  it('respects explicit movementDate when creating a discharge movement', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente A',
      rut: '11-1',
    });

    const result = resolveAddDischargeMovement({
      record,
      bedId: 'R1',
      payload: {
        status: 'Vivo',
        time: '10:00',
        movementDate: '2025-01-02',
        dischargeTarget: 'mother',
      },
      bedsCatalog: BEDS,
      createEmptyPatient,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.updatedRecord.discharges).toHaveLength(1);
      expect(result.value.updatedRecord.discharges[0].movementDate).toBe('2025-01-02');
    }
  });

  it('respects explicit movementDate when creating a transfer movement', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01');
    record.beds.R1 = DataFactory.createMockPatient('R1', {
      patientName: 'Paciente A',
      rut: '11-1',
    });

    const result = resolveAddTransferMovement({
      record,
      bedId: 'R1',
      payload: {
        evacuationMethod: 'Ambulancia',
        receivingCenter: 'Hospital Base',
        receivingCenterOther: '',
        transferEscort: '',
        time: '10:00',
        movementDate: '2025-01-02',
      },
      bedsCatalog: BEDS,
      createEmptyPatient,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.updatedRecord.transfers).toHaveLength(1);
      expect(result.value.updatedRecord.transfers[0].movementDate).toBe('2025-01-02');
    }
  });
});
