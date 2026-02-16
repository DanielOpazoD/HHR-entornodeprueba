import { describe, expect, it } from 'vitest';
import {
  clampBookmarkBarOffset,
  resolveBookmarkBarAlignmentClass,
} from '@/components/bookmarks/controllers/bookmarkBarPreferencesController';

describe('bookmarkBarPreferencesController', () => {
  it('resolves alignment classes', () => {
    expect(resolveBookmarkBarAlignmentClass('left')).toBe('justify-start');
    expect(resolveBookmarkBarAlignmentClass('center')).toBe('justify-center');
    expect(resolveBookmarkBarAlignmentClass('right')).toBe('justify-end');
    expect(resolveBookmarkBarAlignmentClass('custom')).toBe('');
  });

  it('clamps custom offset in allowed range', () => {
    expect(clampBookmarkBarOffset(-5)).toBe(0);
    expect(clampBookmarkBarOffset(42)).toBe(42);
    expect(clampBookmarkBarOffset(99)).toBe(80);
    expect(clampBookmarkBarOffset(Number.NaN)).toBe(0);
  });
});
