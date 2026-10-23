import { describe, expect, it, vi } from 'vitest';
import {
  isDatabaseClosedError,
  openIndexedDbWithRetries,
  resolveIndexedDbErrorDetails,
  resolveIndexedDbRecoveryDelay,
  runIndexedDbOperationWithTimeout,
  waitForIndexedDbOpenResolution,
} from '@/services/storage/indexeddb/indexedDbCoreSupport';

describe('indexedDbCoreSupport', () => {
  it('extracts stable error details from arbitrary values', () => {
    expect(resolveIndexedDbErrorDetails(new Error('boom'))).toEqual({
      errorName: 'Error',
      errorMessage: 'boom',
    });
    expect(resolveIndexedDbErrorDetails('plain failure')).toEqual({
      errorName: 'Unknown',
      errorMessage: 'plain failure',
    });
  });

  it('detects database-closed failures only for the expected error name', () => {
    expect(isDatabaseClosedError({ name: 'DatabaseClosedError' })).toBe(true);
    expect(isDatabaseClosedError({ name: 'AbortError' })).toBe(false);
    expect(isDatabaseClosedError(null)).toBe(false);
  });

  it('clamps recovery delays to the configured retry window', () => {
    expect(resolveIndexedDbRecoveryDelay(1, [10, 20, 30])).toBe(10);
    expect(resolveIndexedDbRecoveryDelay(2, [10, 20, 30])).toBe(20);
    expect(resolveIndexedDbRecoveryDelay(99, [10, 20, 30])).toBe(30);
  });

  it('wraps IndexedDB operations with a timeout boundary', async () => {
    await expect(
      runIndexedDbOperationWithTimeout(() => Promise.resolve('ready'), 1000, 'timed out')
    ).resolves.toBe('ready');

    vi.useFakeTimers();
    const timedOut = runIndexedDbOperationWithTimeout(
      () => new Promise(() => undefined),
      10,
      'indexeddb stalled'
    );
    const timeoutExpectation = expect(timedOut).rejects.toThrow('indexeddb stalled');

    await vi.advanceTimersByTimeAsync(10);
    await timeoutExpectation;
    vi.useRealTimers();
  });

  it('opens with retry delays and rethrows the last failure', async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn().mockRejectedValueOnce(new Error('first')).mockResolvedValueOnce(undefined);

    await expect(openIndexedDbWithRetries({ open, retryDelays: [10, 20], wait })).resolves.toBe(
      undefined
    );
    expect(open).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(10);

    const failingOpen = vi.fn().mockRejectedValue(new Error('last'));
    await expect(
      openIndexedDbWithRetries({ open: failingOpen, retryDelays: [10, 20], wait })
    ).rejects.toThrow('last');
  });

  it('waits for concurrent opens to settle into opened, mock, stalled or settled states', async () => {
    const wait = vi.fn().mockResolvedValue(undefined);

    let opening = true;
    let open = false;
    let mock = false;
    const opened = waitForIndexedDbOpenResolution({
      isOpening: () => opening,
      isDbOpen: () => open,
      isUsingMock: () => mock,
      maxAttempts: 3,
      pollIntervalMs: 1,
      wait: async () => {
        await wait();
        opening = false;
        open = true;
      },
    });
    await expect(opened).resolves.toBe('opened');

    opening = true;
    open = false;
    mock = false;
    const mocked = waitForIndexedDbOpenResolution({
      isOpening: () => opening,
      isDbOpen: () => open,
      isUsingMock: () => mock,
      maxAttempts: 3,
      pollIntervalMs: 1,
      wait: async () => {
        opening = false;
        mock = true;
      },
    });
    await expect(mocked).resolves.toBe('mock');

    await expect(
      waitForIndexedDbOpenResolution({
        isOpening: () => true,
        isDbOpen: () => false,
        isUsingMock: () => false,
        maxAttempts: 2,
        pollIntervalMs: 1,
        wait,
      })
    ).resolves.toBe('stalled');

    await expect(
      waitForIndexedDbOpenResolution({
        isOpening: () => false,
        isDbOpen: () => false,
        isUsingMock: () => false,
      })
    ).resolves.toBe('settled');
  });
});
