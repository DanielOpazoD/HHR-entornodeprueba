import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { resolveCmaSectionState } from '@/features/census/controllers/censusCmaSectionController';

describe('censusCmaSectionController', () => {
  it('resolves null cma as non-renderable state', () => {
    expect(resolveCmaSectionState(null)).toEqual({
      isRenderable: false,
      isEmpty: true,
      cma: [],
    });
  });

  it('resolves undefined cma as renderable empty state', () => {
    expect(resolveCmaSectionState(undefined)).toEqual({
      isRenderable: true,
      isEmpty: true,
      cma: [],
    });
  });

  it('keeps cma records when present', () => {
    const cma = [DataFactory.createMockCMA({ id: 'c1' })];
    const state = resolveCmaSectionState(cma);

    expect(state.isRenderable).toBe(true);
    expect(state.isEmpty).toBe(false);
    expect(state.cma).toHaveLength(1);
  });
});
