import { describe, expect, it } from 'vitest';
import { mergeRayenBedCollisionResolutionReceipts } from '@/features/rayen-import/domain/applyCensusImportDiff';
import type { RayenBedCollisionResolutionReceipt } from '@/types/domain/rayenBedCollision';

const receipt = (
  id: string,
  selectedEpisodeId = `selected-${id}`
): RayenBedCollisionResolutionReceipt => ({
  id,
  selectedEpisodeId,
  otherEpisodeId: `other-${id}`,
  otherDisposition: { kind: 'remove' },
});

describe('mergeRayenBedCollisionResolutionReceipts', () => {
  it('retains an updated old receipt when the bounded history also receives a new one', () => {
    const current = Array.from({ length: 50 }, (_, index) => receipt(`collision-${index}`));
    const updatedOldest = receipt('collision-0', 'selected-updated');

    const merged = mergeRayenBedCollisionResolutionReceipts(current, [
      updatedOldest,
      receipt('collision-new'),
    ]);

    expect(merged).toHaveLength(50);
    expect(merged.at(-2)).toEqual(updatedOldest);
    expect(merged.at(-1)?.id).toBe('collision-new');
    expect(merged.some(item => item.id === 'collision-1')).toBe(false);
  });
});
