import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useMoveCopyTargetRecord } from '@/features/census/hooks/useMoveCopyTargetRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const createDeferred = <T>(): Deferred<T> => {
  let resolve: ((value: T) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  if (!resolve || !reject) {
    throw new Error('Deferred handlers were not initialized');
  }

  return { promise, resolve, reject };
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

  it('calls onError when target record fetch fails', async () => {
    const currentRecord = DataFactory.createMockDailyRecord('2026-02-14');
    const onError = vi.fn();
    const failure = new Error('network down');
    const getRecordForDate = vi.fn().mockRejectedValue(failure);

    const { result } = renderHook(() =>
      useMoveCopyTargetRecord({
        isOpen: true,
        selectedDate: '2026-02-15',
        currentRecord,
        getRecordForDate,
        onError,
      })
    );

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(failure);
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('clears stale target record while loading a new date and keeps null after error', async () => {
    const currentRecord = DataFactory.createMockDailyRecord('2026-02-14');
    const loadedRecord = DataFactory.createMockDailyRecord('2026-02-13');
    const pendingRequest = createDeferred<DailyRecord | null>();
    const onError = vi.fn();
    const getRecordForDate = vi
      .fn()
      .mockResolvedValueOnce(loadedRecord)
      .mockImplementationOnce(() => pendingRequest.promise);

    const { result, rerender } = renderHook(
      ({ selectedDate }) =>
        useMoveCopyTargetRecord({
          isOpen: true,
          selectedDate,
          currentRecord,
          getRecordForDate,
          onError,
        }),
      { initialProps: { selectedDate: '2026-02-13' } }
    );

    await waitFor(() => {
      expect(result.current.targetRecord?.date).toBe('2026-02-13');
      expect(result.current.isLoading).toBe(false);
    });

    rerender({ selectedDate: '2026-02-15' });

    await waitFor(() => {
      expect(result.current.targetRecord).toBeNull();
      expect(result.current.isLoading).toBe(true);
    });

    const failure = new Error('target fetch failed');
    await act(async () => {
      pendingRequest.reject(failure);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(failure);
      expect(result.current.targetRecord).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('ignores stale request errors after newer selection succeeds', async () => {
    const currentRecord = DataFactory.createMockDailyRecord('2026-02-14');
    const staleRequest = createDeferred<DailyRecord | null>();
    const latestRecord = DataFactory.createMockDailyRecord('2026-02-15');
    const onError = vi.fn();
    const getRecordForDate = vi
      .fn()
      .mockImplementationOnce(() => staleRequest.promise)
      .mockResolvedValueOnce(latestRecord);

    const { result, rerender } = renderHook(
      ({ selectedDate }) =>
        useMoveCopyTargetRecord({
          isOpen: true,
          selectedDate,
          currentRecord,
          getRecordForDate,
          onError,
        }),
      { initialProps: { selectedDate: '2026-02-13' } }
    );

    rerender({ selectedDate: '2026-02-15' });

    await waitFor(() => {
      expect(result.current.targetRecord?.date).toBe('2026-02-15');
    });

    await act(async () => {
      staleRequest.reject(new Error('stale failure'));
      await Promise.resolve();
    });

    expect(onError).not.toHaveBeenCalled();
  });

  it('does not refetch when current record object changes but date stays the same', async () => {
    const initialRecord = DataFactory.createMockDailyRecord('2026-02-14');
    const updatedRecord = {
      ...initialRecord,
      beds: {
        ...initialRecord.beds,
      },
      lastUpdated: new Date('2026-02-14T12:00:00.000Z').toISOString(),
    };
    const fetched = DataFactory.createMockDailyRecord('2026-02-15');
    const getRecordForDate = vi.fn().mockResolvedValue(fetched);

    const { result, rerender } = renderHook(
      ({ currentRecord }) =>
        useMoveCopyTargetRecord({
          isOpen: true,
          selectedDate: '2026-02-15',
          currentRecord,
          getRecordForDate,
        }),
      { initialProps: { currentRecord: initialRecord } }
    );

    await waitFor(() => {
      expect(result.current.targetRecord?.date).toBe('2026-02-15');
    });
    expect(getRecordForDate).toHaveBeenCalledTimes(1);

    rerender({ currentRecord: updatedRecord });

    await waitFor(() => {
      expect(result.current.targetRecord?.date).toBe('2026-02-15');
    });
    expect(getRecordForDate).toHaveBeenCalledTimes(1);
  });
});
