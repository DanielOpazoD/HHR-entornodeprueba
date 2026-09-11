// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import '../../../extension/health-report-cache-runtime.js';

type Runtime = {
  create: (deps: Record<string, unknown>) => {
    read: (options?: { force?: boolean }) => Promise<unknown>;
    invalidate: () => void;
  };
};

const runtime = (globalThis as unknown as { HhrHealthReportCacheRuntime: Runtime })
  .HhrHealthReportCacheRuntime;

describe('health report cache runtime', () => {
  it('coalesces concurrent probes and reuses a short-lived report', async () => {
    let release: ((value: unknown) => void) | undefined;
    const readHealth = vi.fn(
      () =>
        new Promise(resolve => {
          release = resolve;
        })
    );
    let now = 1000;
    const cache = runtime.create({ readHealth, now: () => now, ttlMs: 3000 });

    const first = cache.read();
    const second = cache.read();
    await Promise.resolve();
    expect(readHealth).toHaveBeenCalledTimes(1);
    release?.({ checkedAt: 'first' });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { checkedAt: 'first' },
      { checkedAt: 'first' },
    ]);

    now += 2000;
    await expect(cache.read()).resolves.toEqual({ checkedAt: 'first' });
    expect(readHealth).toHaveBeenCalledTimes(1);
  });

  it('refreshes after expiry, force or explicit invalidation', async () => {
    let now = 1000;
    const readHealth = vi.fn(async () => ({ sequence: readHealth.mock.calls.length }));
    const cache = runtime.create({ readHealth, now: () => now, ttlMs: 3000 });

    await expect(cache.read()).resolves.toEqual({ sequence: 1 });
    await expect(cache.read({ force: true })).resolves.toEqual({ sequence: 2 });
    cache.invalidate();
    await expect(cache.read()).resolves.toEqual({ sequence: 3 });
    now += 4000;
    await expect(cache.read()).resolves.toEqual({ sequence: 4 });
  });

  it('does not cache a failed probe', async () => {
    const readHealth = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ status: 'ready' });
    const cache = runtime.create({ readHealth });

    await expect(cache.read()).rejects.toThrow('offline');
    await expect(cache.read()).resolves.toEqual({ status: 'ready' });
    expect(readHealth).toHaveBeenCalledTimes(2);
  });
});
