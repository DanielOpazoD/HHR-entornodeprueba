import { describe, expect, it } from 'vitest';
import { BEDS } from '@/constants';
import {
  resolveBlockedBedsGridItems,
  resolveExtraBedsGridItems,
} from '@/features/census/controllers/bedManagerGridItemsController';

describe('bedManagerGridItemsController', () => {
  it('maps regular beds with blocked state and reason', () => {
    const items = resolveBlockedBedsGridItems(BEDS, {
      R1: { isBlocked: true, blockedReason: 'Aislamiento' } as any,
      R2: { isBlocked: false } as any,
    });

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
});
