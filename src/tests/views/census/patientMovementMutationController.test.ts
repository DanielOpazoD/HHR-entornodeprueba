import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  resolveDeleteDischargeMovement,
  resolveDeleteTransferMovement,
  resolveUpdateDischargeMovement,
  resolveUpdateTransferMovement,
} from '@/features/census/controllers/patientMovementMutationController';

describe('patientMovementMutationController', () => {
  it('updates discharge fields for matching id', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01', {
      discharges: [
        DataFactory.createMockDischarge({
          id: 'd-1',
          status: 'Vivo',
          time: '08:00',
          dischargeType: 'Domicilio (Habitual)',
        }),
      ],
    });

    const updated = resolveUpdateDischargeMovement({
      record,
      id: 'd-1',
      status: 'Fallecido',
      dischargeType: 'Otra',
      dischargeTypeOther: 'Detalle',
      time: '10:00',
    });

    expect(updated.discharges[0].status).toBe('Fallecido');
    expect(updated.discharges[0].dischargeType).toBeUndefined();
    expect(updated.discharges[0].dischargeTypeOther).toBeUndefined();
    expect(updated.discharges[0].time).toBe('10:00');
  });

  it('updates discharge diagnosis without losing existing discharge metadata', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01', {
      discharges: [
        DataFactory.createMockDischarge({
          id: 'd-1',
          status: 'Vivo',
          diagnosis: 'Neumonia',
          dischargeType: 'Domicilio (Habitual)',
          time: '08:00',
          movementDate: '2025-01-01',
        }),
      ],
    });

    const updated = resolveUpdateDischargeMovement({
      record,
      id: 'd-1',
      status: 'Vivo',
      diagnosis: 'Neumonia resuelta',
    });

    expect(updated.discharges[0]).toMatchObject({
      id: 'd-1',
      diagnosis: 'Neumonia resuelta',
      dischargeType: 'Domicilio (Habitual)',
      time: '08:00',
      movementDate: '2025-01-01',
    });
  });

  it('tombstones discharge by id without removing the persisted movement', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01', {
      discharges: [
        DataFactory.createMockDischarge({ id: 'd-1' }),
        DataFactory.createMockDischarge({ id: 'd-2' }),
      ],
    });

    const updated = resolveDeleteDischargeMovement({ record, id: 'd-1' });
    expect(updated.discharges).toHaveLength(2);
    expect(updated.discharges[0]).toMatchObject({
      id: 'd-1',
      deletedAt: expect.any(String),
      deletedReason: 'manual_delete',
    });
    expect(updated.discharges[1].id).toBe('d-2');
  });

  it('updates transfer by id with partial updates', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01', {
      transfers: [
        DataFactory.createMockTransfer({ id: 't-1', receivingCenter: 'Centro A', time: '09:00' }),
      ],
    });

    const updated = resolveUpdateTransferMovement({
      record,
      id: 't-1',
      updates: {
        receivingCenter: 'Centro B',
        time: '11:00',
      },
    });

    expect(updated.transfers[0].receivingCenter).toBe('Centro B');
    expect(updated.transfers[0].time).toBe('11:00');
  });

  it('updates transfer diagnosis by id without changing destination fields', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01', {
      transfers: [
        DataFactory.createMockTransfer({
          id: 't-1',
          diagnosis: 'Apendicitis',
          receivingCenter: 'Centro A',
          time: '09:00',
        }),
      ],
    });

    const updated = resolveUpdateTransferMovement({
      record,
      id: 't-1',
      updates: {
        diagnosis: 'Postoperatorio estable',
      },
    });

    expect(updated.transfers[0]).toMatchObject({
      diagnosis: 'Postoperatorio estable',
      receivingCenter: 'Centro A',
      time: '09:00',
    });
  });

  it('tombstones transfer by id without removing the persisted movement', () => {
    const record = DataFactory.createMockDailyRecord('2025-01-01', {
      transfers: [
        DataFactory.createMockTransfer({ id: 't-1' }),
        DataFactory.createMockTransfer({ id: 't-2' }),
      ],
    });

    const updated = resolveDeleteTransferMovement({ record, id: 't-2' });
    expect(updated.transfers).toHaveLength(2);
    expect(updated.transfers[0].id).toBe('t-1');
    expect(updated.transfers[1]).toMatchObject({
      id: 't-2',
      deletedAt: expect.any(String),
      deletedReason: 'manual_delete',
    });
  });
});
