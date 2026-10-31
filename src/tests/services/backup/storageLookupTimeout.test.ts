import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createStorageLookupResult,
  withStorageLookupTimeout,
} from '@/services/backup/storageLookupContracts';

describe('withStorageLookupTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports no timeout when the lookup answers in time', async () => {
    const onTimeout = vi.fn();
    const answer = createStorageLookupResult(true, 'available');

    await expect(
      withStorageLookupTimeout(Promise.resolve(answer), 4000, onTimeout)
    ).resolves.toEqual(answer);
    await vi.advanceTimersByTimeAsync(5000);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('reports no timeout when the lookup fails in time', async () => {
    const onTimeout = vi.fn();

    await expect(
      withStorageLookupTimeout(Promise.reject(new Error('Synthetic failure')), 4000, onTimeout)
    ).rejects.toThrow('Synthetic failure');
    await vi.advanceTimersByTimeAsync(5000);

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('answers timeout when the lookup never settles', async () => {
    const onTimeout = vi.fn();

    const result = withStorageLookupTimeout(new Promise(() => {}), 4000, onTimeout);
    await vi.advanceTimersByTimeAsync(4000);

    await expect(result).resolves.toEqual(createStorageLookupResult(false, 'timeout'));
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});
