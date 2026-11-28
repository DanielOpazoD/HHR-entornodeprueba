// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BEDS } from '@/constants/beds';
import { resolveBlockedBedsGridItems } from '@/features/census/controllers/bedManagerGridItemsController';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';

describe('bedManagerGridItemsController', () => {
  it('maps regular beds with blocked state and reason', () => {
    const recordBeds: DailyRecord['beds'] = {
      ...DataFactory.createMockDailyRecord('2026-01-01').beds,
      R1: DataFactory.createMockPatient('R1', {
        isBlocked: true,
        blockedReason: 'Aislamiento',
      }),
      R2: DataFactory.createMockPatient('R2', {
        isBlocked: false,
      }),
    };
    const items = resolveBlockedBedsGridItems(BEDS, recordBeds);

    const r1 = items.find(item => item.id === 'R1');
    const r2 = items.find(item => item.id === 'R2');
    const e1 = items.find(item => item.id === 'E1');

    expect(r1).toEqual({
      id: 'R1',
      name: 'R1',
      isBlocked: true,
      blockedReason: 'Aislamiento',
    });
    expect(r2?.isBlocked).toBe(false);
    expect(e1).toBeUndefined();
  });
});
