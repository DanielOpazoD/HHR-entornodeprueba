// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import '../../../extension/sync-bundle-cancellation-runtime.js';

interface CancellationRuntime {
  CANCELLED_MESSAGE: string;
  MAX_TRACKED: number;
  create: () => {
    cancel: (requestId: unknown) => { ok: boolean };
    isCancelled: (requestId: string) => boolean;
    release: (requestId: string) => boolean;
    run: <T>(
      requestId: string,
      capture: () => Promise<T>
    ) => Promise<T | { error: string; cancelled: true }>;
  };
}

const runtime = (
  globalThis as typeof globalThis & { HhrSyncBundleCancellationRuntime: CancellationRuntime }
).HhrSyncBundleCancellationRuntime;

/**
 * Cancelar desde HHR debe llegar al worker: la captura no arranca si el cancel llegó antes, su
 * resultado se descarta si llegó mientras leía, y la memoria del registro está acotada.
 */
describe('sync bundle cancellation runtime', () => {
  it('skips a capture that was cancelled before it started', async () => {
    const registry = runtime.create();
    const capture = vi.fn().mockResolvedValue({ ok: true });
    expect(registry.cancel('sync-1')).toEqual({ ok: true });

    await expect(registry.run('sync-1', capture)).resolves.toEqual({
      error: runtime.CANCELLED_MESSAGE,
      cancelled: true,
    });
    expect(capture).not.toHaveBeenCalled();
    // The id is released so a reused request id could run again later.
    expect(registry.isCancelled('sync-1')).toBe(false);
  });

  it('drops the result when the cancellation arrived while the sources were being read', async () => {
    const registry = runtime.create();
    const capture = vi.fn(async () => {
      registry.cancel('sync-2');
      return { ok: true, snapshot: {}, bundle: {} };
    });

    await expect(registry.run('sync-2', capture)).resolves.toMatchObject({ cancelled: true });
    expect(registry.isCancelled('sync-2')).toBe(false);
  });

  it('returns the capture untouched when nobody cancelled', async () => {
    const registry = runtime.create();
    const result = { ok: true, snapshot: { encounters: [] }, bundle: { id: 'b' } };
    await expect(registry.run('sync-3', async () => result)).resolves.toBe(result);
  });

  it('rejects empty ids and evicts the oldest cancellations beyond the cap', () => {
    const registry = runtime.create();
    expect(registry.cancel('')).toEqual({ ok: false });
    expect(registry.cancel(undefined)).toEqual({ ok: false });
    registry.cancel('sync-old');
    for (let index = 0; index < runtime.MAX_TRACKED + 5; index += 1) {
      registry.cancel(`sync-bulk-${index}`);
    }
    expect(registry.isCancelled('sync-old')).toBe(false);
    expect(registry.isCancelled(`sync-bulk-${runtime.MAX_TRACKED + 4}`)).toBe(true);
  });
});
