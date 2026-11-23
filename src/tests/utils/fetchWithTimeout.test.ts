import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('aborts a stalled request when the timeout expires and surfaces timeoutMessage', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            capturedSignal = init?.signal ?? undefined;
            capturedSignal?.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError'))
            );
          })
      )
    );

    const pending = fetchWithTimeout('/api/slow', {
      timeoutMs: 250,
      timeoutMessage: 'Tiempo agotado.',
    });
    const rejection = expect(pending).rejects.toThrow('Tiempo agotado.');
    await vi.advanceTimersByTimeAsync(250);
    await rejection;
    expect(capturedSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forwards external AbortSignal cancellation and clears the timeout timer', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            capturedSignal = init?.signal ?? undefined;
            capturedSignal?.addEventListener('abort', () =>
              reject(new DOMException('Caller cancelled', 'AbortError'))
            );
          })
      )
    );

    const caller = new AbortController();
    const pending = fetchWithTimeout('/api/cancelable', {
      timeoutMs: 10_000,
      timeoutMessage: 'Tiempo agotado.',
      signal: caller.signal,
    });
    const rejection = expect(pending).rejects.toThrow('Caller cancelled');
    caller.abort();
    await rejection;
    expect(capturedSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
