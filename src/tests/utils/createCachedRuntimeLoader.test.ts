import { describe, expect, it, vi } from 'vitest';
import { createCachedRuntimeLoader } from '@/services/runtime/createCachedRuntimeLoader';

describe('createCachedRuntimeLoader', () => {
  it('loads once for concurrent and later callers after success', async () => {
    const module = { value: 'synthetic module' };
    const loader = vi.fn().mockResolvedValue(module);
    const load = createCachedRuntimeLoader(loader);
    const first = load();
    const concurrent = load();
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toBe(module);
    await expect(concurrent).resolves.toBe(module);
    await expect(load()).resolves.toBe(module);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('preserves the failure for every caller and loads again only on demand', async () => {
    const failure = new Error('synthetic import failure');
    const module = { value: 'recovered' };
    const loader = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(module);
    const load = createCachedRuntimeLoader(loader);
    const results = await Promise.allSettled([load(), load()]);
    expect(results).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(load()).resolves.toBe(module);
    await expect(load()).resolves.toBe(module);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
