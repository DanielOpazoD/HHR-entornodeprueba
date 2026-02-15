import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { resolveTransfersSectionState } from '@/features/census/controllers/censusTransfersSectionController';

describe('censusTransfersSectionController', () => {
  it('resolves null transfers as non-renderable state', () => {
    expect(resolveTransfersSectionState(null)).toEqual({
      isRenderable: false,
      isEmpty: true,
      transfers: [],
    });
  });

  it('resolves undefined transfers as renderable empty state', () => {
    expect(resolveTransfersSectionState(undefined)).toEqual({
      isRenderable: true,
      isEmpty: true,
      transfers: [],
    });
  });

  it('keeps transfer list when present', () => {
    const transfers = [DataFactory.createMockTransfer({ id: 't1' })];
    const state = resolveTransfersSectionState(transfers);
    expect(state.isRenderable).toBe(true);
    expect(state.isEmpty).toBe(false);
    expect(state.transfers).toHaveLength(1);
  });
});
