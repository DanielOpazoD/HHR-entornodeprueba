import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useSingleFlightAsyncCommand } from '@/features/census/hooks/useSingleFlightAsyncCommand';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve: ((value: T) => void) | null = null;
  const promise = new Promise<T>(res => {
    resolve = res;
  });

  if (!resolve) {
    throw new Error('Deferred resolver was not initialized');
  }

  return { promise, resolve };
};

describe('useSingleFlightAsyncCommand', () => {
  it('prevents concurrent execution while a task is running', async () => {
    const { result } = renderHook(() => useSingleFlightAsyncCommand());
    const deferred = createDeferred<void>();
    const task = vi.fn(async () => deferred.promise);

    let firstStart = false;
    let secondStart = false;

    act(() => {
      firstStart = result.current.runSingleFlight(task);
      secondStart = result.current.runSingleFlight(task);
    });

    expect(firstStart).toBe(true);
    expect(secondStart).toBe(false);
    expect(task).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve(undefined);
      await Promise.resolve();
    });

    act(() => {
      result.current.runSingleFlight(task);
    });

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('marks hook as unmounted on cleanup', () => {
    const { result, unmount } = renderHook(() => useSingleFlightAsyncCommand());
    const isMounted = result.current.isMounted;

    expect(isMounted()).toBe(true);
    unmount();
    expect(isMounted()).toBe(false);
  });
});
