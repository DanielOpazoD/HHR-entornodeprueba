import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMoveCopyTargetRecord } from '@/features/census/hooks/useMoveCopyTargetRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types';

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

describe('useMoveCopyTargetRecord', () => {
  it('returns current record when selected date is current date', async () => {
    const currentRecord = DataFactory.createMockDailyRecord('2026-02-14');
    const getRecordForDate = vi.fn();

    const { result } = renderHook(() =>
      useMoveCopyTargetRecord({
        isOpen: true,
        selectedDate: '2026-02-14',
        currentRecord,
        getRecordForDate,
      })
    );

    await waitFor(() => {
      expect(result.current.targetRecord).toEqual(currentRecord);
      expect(result.current.isLoading).toBe(false);
    });
    expect(getRecordForDate).not.toHaveBeenCalled();
  });

  it('ignores stale requests when date changes quickly', async () => {
    const currentRecord = DataFactory.createMockDailyRecord('2026-02-14');
    const olderResponse = createDeferred<DailyRecord | null>();
    const latestResponse = createDeferred<DailyRecord | null>();
    const getRecordForDate = vi
      .fn()
      .mockImplementationOnce(() => olderResponse.promise)
      .mockImplementationOnce(() => latestResponse.promise);

    const { result, rerender } = renderHook(
      ({ selectedDate }) =>
        useMoveCopyTargetRecord({
          isOpen: true,
          selectedDate,
          currentRecord,
          getRecordForDate,
        }),
      { initialProps: { selectedDate: '2026-02-13' } }
    );

    rerender({ selectedDate: '2026-02-15' });

    const latestRecord = DataFactory.createMockDailyRecord('2026-02-15');
    await act(async () => {
      latestResponse.resolve(latestRecord);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.targetRecord?.date).toBe('2026-02-15');
    });

    const staleRecord = DataFactory.createMockDailyRecord('2026-02-13');
    await act(async () => {
      olderResponse.resolve(staleRecord);
      await Promise.resolve();
    });

    expect(result.current.targetRecord?.date).toBe('2026-02-15');
  });

  it('resets state when modal closes', async () => {
    const currentRecord = DataFactory.createMockDailyRecord('2026-02-14');
    const getRecordForDate = vi.fn().mockResolvedValue(currentRecord);

    const { result, rerender } = renderHook(
      ({ isOpen }) =>
        useMoveCopyTargetRecord({
          isOpen,
          selectedDate: '2026-02-14',
          currentRecord,
          getRecordForDate,
        }),
      { initialProps: { isOpen: true } }
    );

    await waitFor(() => {
      expect(result.current.targetRecord?.date).toBe('2026-02-14');
    });

    rerender({ isOpen: false });

    await waitFor(() => {
      expect(result.current.targetRecord).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });
  });
});
