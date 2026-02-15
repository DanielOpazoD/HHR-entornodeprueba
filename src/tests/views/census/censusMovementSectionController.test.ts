import { describe, expect, it } from 'vitest';
import { resolveMovementSectionState } from '@/features/census/controllers/censusMovementSectionController';

describe('censusMovementSectionController', () => {
  it('returns non-renderable state when list is null', () => {
    expect(resolveMovementSectionState<string>(null)).toEqual({
      isRenderable: false,
      isEmpty: true,
      items: [],
    });
  });

  it('returns renderable empty state when list is undefined', () => {
    expect(resolveMovementSectionState<string>(undefined)).toEqual({
      isRenderable: true,
      isEmpty: true,
      items: [],
    });
  });

  it('keeps items and marks non-empty when list has data', () => {
    expect(resolveMovementSectionState([{ id: '1' }])).toEqual({
      isRenderable: true,
      isEmpty: false,
      items: [{ id: '1' }],
    });
  });
});
