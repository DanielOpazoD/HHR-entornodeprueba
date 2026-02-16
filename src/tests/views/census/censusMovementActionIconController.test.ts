import { describe, expect, it } from 'vitest';
import { resolveCensusMovementActionIconName } from '@/features/census/controllers/censusMovementActionIconController';

describe('censusMovementActionIconController', () => {
  it('maps action kind to icon name', () => {
    expect(resolveCensusMovementActionIconName('undo')).toBe('undo');
    expect(resolveCensusMovementActionIconName('edit')).toBe('edit');
    expect(resolveCensusMovementActionIconName('delete')).toBe('delete');
  });
});
