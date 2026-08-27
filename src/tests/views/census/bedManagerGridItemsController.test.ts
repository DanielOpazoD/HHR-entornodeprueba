import { describe, expect, it } from 'vitest';
import { BEDS } from '@/constants/beds';
import {
  resolveBlockedBedsGridItems,
  resolveExtraBedsGridItems,
} from '@/features/census/controllers/bedManagerGridItemsController';
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

  it('maps extra beds with enabled state from active list', () => {
    const items = resolveExtraBedsGridItems(BEDS, ['E1', 'E3']);

    const e1 = items.find(item => item.id === 'E1');
    const e2 = items.find(item => item.id === 'E2');
    const r1 = items.find(item => item.id === 'R1');

    expect(e1?.isEnabled).toBe(true);
    expect(e2?.isEnabled).toBe(false);
    expect(r1).toBeUndefined();
  });

  it('does not offer occupied-only Urgencias boxes as manually available beds', () => {
    const items = resolveExtraBedsGridItems(BEDS, ['BOX1']);

    expect(items.some(item => item.id === 'BOX1')).toBe(false);
    expect(items.some(item => item.id === 'BOX2')).toBe(false);
  });
});
