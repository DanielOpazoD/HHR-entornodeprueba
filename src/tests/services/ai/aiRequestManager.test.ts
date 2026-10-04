import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('AIRequestManager', () => {
  let manager: typeof import('@/services/ai/aiRequestManager').aiRequestManager;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    manager = (await import('@/services/ai/aiRequestManager')).aiRequestManager;
  });

  afterEach(async () => {
    // Finish the scheduled empty-queue check before restoring the real clock.
    try {
      await vi.runAllTimersAsync();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it('executes requests and forwards the abort signal', async () => {
    const controller = new AbortController();
    const recipe = vi.fn().mockResolvedValue('success');
    await expect(manager.enqueue('simple', recipe, controller.signal)).resolves.toBe('success');
    expect(recipe).toHaveBeenCalledExactlyOnceWith(controller.signal);
  });

  it('rejects an already aborted request without executing it', async () => {
    const controller = new AbortController();
    controller.abort();
    const recipe = vi.fn().mockResolvedValue('unused');
    await expect(manager.enqueue('aborted', recipe, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(recipe).not.toHaveBeenCalled();
  });

  it('does not retry a non-retryable error', async () => {
    const recipe = vi.fn().mockRejectedValue(new Error('API Error'));
    await expect(manager.enqueue('failed', recipe)).rejects.toThrow('API Error');
    expect(recipe).toHaveBeenCalledTimes(1);
  });

  it('waits 1500 ms between consecutive requests', async () => {
    const first = vi.fn().mockResolvedValue('first');
    const second = vi.fn().mockResolvedValue('second');
    const firstResult = manager.enqueue('first', first);
    const secondResult = manager.enqueue('second', second);
    await expect(firstResult).resolves.toBe('first');
    await vi.advanceTimersByTimeAsync(1499);
    expect(second).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(secondResult).resolves.toBe('second');
    expect(second).toHaveBeenCalledTimes(1);
  });

  it.each([429, 503])('retries status %s with bounded exponential backoff', async status => {
    const error = Object.assign(new Error(`Status ${status}`), { status });
    const recipe = vi.fn().mockRejectedValue(error);
    // Register the rejection before advancing time to avoid an unhandled promise.
    const result = expect(manager.enqueue('retry', recipe)).rejects.toBe(error);
    expect(recipe).toHaveBeenCalledTimes(1);
    for (const [index, delay] of [2000, 4000, 8000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(recipe).toHaveBeenCalledTimes(index + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(recipe).toHaveBeenCalledTimes(index + 2);
    }
    await result;
    await vi.runAllTimersAsync();
    expect(recipe).toHaveBeenCalledTimes(4);
  });
});
