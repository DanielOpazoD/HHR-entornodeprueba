import { describe, expect, it } from 'vitest';
import {
  getActiveCma,
  getActiveDischarges,
  getActiveTransfers,
  isMovementDeleted,
  tombstoneMovementById,
} from '@/application/census/movementTombstonePolicy';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('movement tombstone policy', () => {
  it('filters tombstoned movements from active movement lists', () => {
    const activeDischarge = DataFactory.createMockDischarge({ id: 'd-active' });
    const deletedDischarge = DataFactory.createMockDischarge({
      id: 'd-deleted',
      deletedAt: '2026-05-12T10:00:00.000Z',
    });
    const activeTransfer = DataFactory.createMockTransfer({ id: 't-active' });
    const deletedTransfer = DataFactory.createMockTransfer({
      id: 't-deleted',
      deletedAt: '2026-05-12T10:00:00.000Z',
    });
    const activeCma = DataFactory.createMockCMA({ id: 'cma-active' });
    const deletedCma = DataFactory.createMockCMA({
      id: 'cma-deleted',
      deletedAt: '2026-05-12T10:00:00.000Z',
    });

    expect(isMovementDeleted(deletedDischarge)).toBe(true);
    expect(getActiveDischarges([activeDischarge, deletedDischarge])).toEqual([activeDischarge]);
    expect(getActiveTransfers([activeTransfer, deletedTransfer])).toEqual([activeTransfer]);
    expect(getActiveCma([activeCma, deletedCma])).toEqual([activeCma]);
  });

  it('marks a movement as deleted without removing it from the persisted list', () => {
    const movements = [
      DataFactory.createMockTransfer({ id: 't-1' }),
      DataFactory.createMockTransfer({ id: 't-2' }),
    ];

    const result = tombstoneMovementById(movements, 't-2', {
      deletedAt: '2026-05-12T10:00:00.000Z',
      deletedBy: 'tester',
      deletedReason: 'manual_delete',
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(movements[0]);
    expect(result[1]).toMatchObject({
      id: 't-2',
      deletedAt: '2026-05-12T10:00:00.000Z',
      deletedBy: 'tester',
      deletedReason: 'manual_delete',
    });
  });
});
