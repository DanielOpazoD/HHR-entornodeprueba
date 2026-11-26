// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { preloadCensusComponentsChunk } from '@/features/census';

describe('census public preload API', () => {
  it('exposes a public preload for heavy census components', async () => {
    const loadCensusComponents = vi.fn().mockResolvedValue({});

    await preloadCensusComponentsChunk(loadCensusComponents);

    expect(loadCensusComponents).toHaveBeenCalledTimes(1);
  });
});
