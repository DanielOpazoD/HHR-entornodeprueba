import { describe, expect, it } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { resolveDischargesSectionState } from '@/features/census/controllers/censusDischargesSectionController';

describe('censusDischargesSectionController', () => {
  it('resolves null discharges as non-renderable state', () => {
    expect(resolveDischargesSectionState(null)).toEqual({
      isRenderable: false,
      isEmpty: true,
      discharges: [],
    });
  });

  it('resolves undefined discharges as renderable empty state', () => {
    expect(resolveDischargesSectionState(undefined)).toEqual({
      isRenderable: true,
      isEmpty: true,
      discharges: [],
    });
  });

  it('keeps discharge list when present', () => {
    const discharges = [DataFactory.createMockDischarge({ id: 'd1' })];
    const state = resolveDischargesSectionState(discharges);
    expect(state.isRenderable).toBe(true);
    expect(state.isEmpty).toBe(false);
    expect(state.discharges).toHaveLength(1);
  });
});
