import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMovementReclassificationExecution } from '@/hooks/useMovementReclassificationExecution';

describe('useMovementReclassificationExecution', () => {
  it('claims one source movement until persistence completes', async () => {
    let resolvePersistence: (() => void) | undefined;
    const persist = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolvePersistence = resolve;
        })
    );
    const onPersisted = vi.fn();
    const onPersistenceError = vi.fn();
    const { result } = renderHook(() => useMovementReclassificationExecution());
    const execution = {
      recordDate: '2026-07-14',
      sourceMovementId: 'discharge-1',
      persist,
      onPersisted,
      onPersistenceError,
    };

    act(() => {
      expect(result.current(execution)).toBe(true);
      expect(result.current(execution)).toBe(false);
    });
    expect(persist).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePersistence?.();
      await Promise.resolve();
    });
    expect(onPersisted).toHaveBeenCalledTimes(1);
    expect(onPersistenceError).not.toHaveBeenCalled();
    expect(result.current(execution)).toBe(false);
  });

  it('releases the claim after persistence fails so a deliberate retry can proceed', async () => {
    const persist = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const onPersistenceError = vi.fn();
    const { result } = renderHook(() => useMovementReclassificationExecution());
    const execution = {
      recordDate: '2026-07-14',
      sourceMovementId: 'transfer-1',
      persist,
      onPersisted: vi.fn(),
      onPersistenceError,
    };

    act(() => {
      expect(result.current(execution)).toBe(true);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(onPersistenceError).toHaveBeenCalledTimes(1);

    act(() => {
      expect(result.current(execution)).toBe(true);
    });
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('reports a post-persistence callback failure without releasing the successful claim', async () => {
    const callbackError = new Error('audit callback failed');
    const persist = vi.fn().mockResolvedValue(undefined);
    const onPersistenceError = vi.fn();
    const { result } = renderHook(() => useMovementReclassificationExecution());
    const execution = {
      recordDate: '2026-07-14',
      sourceMovementId: 'cma-1',
      persist,
      onPersisted: vi.fn(() => {
        throw callbackError;
      }),
      onPersistenceError,
    };

    act(() => {
      expect(result.current(execution)).toBe(true);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onPersistenceError).toHaveBeenCalledWith(callbackError);
    expect(result.current(execution)).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
