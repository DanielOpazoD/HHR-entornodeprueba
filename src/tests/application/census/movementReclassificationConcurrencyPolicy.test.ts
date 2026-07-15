import { describe, expect, it } from 'vitest';
import {
  findActiveMovementLineageConflicts,
  isMovementReclassificationPatch,
} from '@/application/census/movementReclassificationConcurrencyPolicy';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const movement = (id: string, lineageId: string, deletedAt?: string) => ({
  id,
  deletedAt,
  movementProvenance: {
    source: 'manual' as const,
    lineageId,
    classifiedAt: '2026-07-14T10:00:00.000Z',
  },
});

describe('movementReclassificationConcurrencyPolicy', () => {
  it('identifies only multi-list movement patches as reclassifications', () => {
    expect(isMovementReclassificationPatch({ discharges: [], cma: [] })).toBe(true);
    expect(isMovementReclassificationPatch({ transfers: [], discharges: [] })).toBe(true);
    expect(isMovementReclassificationPatch({ discharges: [], 'beds.R1': {} } as never)).toBe(false);
  });

  it('finds the same active lineage in two classifications and ignores tombstones', () => {
    const record = {
      discharges: [movement('d-1', 'lineage-1', '2026-07-14T10:01:00.000Z')],
      transfers: [movement('t-1', 'lineage-1')],
      cma: [movement('c-1', 'lineage-1')],
    } as unknown as Pick<DailyRecord, 'discharges' | 'transfers' | 'cma'>;

    expect(findActiveMovementLineageConflicts(record)).toEqual([
      {
        lineageId: 'lineage-1',
        classifications: ['transfer', 'cma'],
        movementIds: ['t-1', 'c-1'],
      },
    ]);
  });
});
