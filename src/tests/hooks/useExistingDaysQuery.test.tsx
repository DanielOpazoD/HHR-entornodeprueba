import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExistingDaysQuery } from '@/hooks/useExistingDaysQuery';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import {
  DAILY_RECORD_STORE_CHANGED_EVENT,
  type DailyRecordStoreChangedEventDetail,
} from '@/services/storage/indexeddb/indexedDbRecordEvents';

const mockFetchExistingDaysInMonth = vi.fn();
const mockDoStoredDaysHavePatientData = vi.fn();

vi.mock('@/services/records/recordQueryService', () => ({
  fetchExistingDaysInMonth: (...args: unknown[]) => mockFetchExistingDaysInMonth(...args),
  doStoredDaysHavePatientData: (...args: unknown[]) => mockDoStoredDaysHavePatientData(...args),
}));

const storeChanged = (detail: DailyRecordStoreChangedEventDetail) =>
  act(() => {
    window.dispatchEvent(new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, { detail }));
  });

describe('useExistingDaysQuery', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.clearAllMocks();
    // Queued one-off answers must not leak into the next test when one fails midway.
    mockFetchExistingDaysInMonth.mockReset();
    mockDoStoredDaysHavePatientData.mockReset();
  });

  it('refreshes the current month immediately when the local record store changes', async () => {
    mockFetchExistingDaysInMonth.mockResolvedValueOnce([7]).mockResolvedValueOnce([7, 14]);

    const { wrapper } = createQueryClientTestWrapper();
    const { result } = renderHook(() => useExistingDaysQuery(2026, 3), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual([7]);
    });

    window.dispatchEvent(
      new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
        detail: { operation: 'save', dates: ['2026-04-14'] },
      })
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([7, 14]);
    });

    expect(mockFetchExistingDaysInMonth).toHaveBeenNthCalledWith(1, 2026, 4);
    expect(mockFetchExistingDaysInMonth).toHaveBeenNthCalledWith(2, 2026, 4);
  });

  it('ignores store changes from other months', async () => {
    mockFetchExistingDaysInMonth.mockResolvedValueOnce([7]);

    const { wrapper } = createQueryClientTestWrapper();
    const { result } = renderHook(() => useExistingDaysQuery(2026, 3), { wrapper });

    await waitFor(() => {
      expect(result.current.data).toEqual([7]);
    });

    window.dispatchEvent(
      new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
        detail: { operation: 'save', dates: ['2026-05-01'] },
      })
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([7]);
    });

    expect(mockFetchExistingDaysInMonth).toHaveBeenCalledTimes(1);
  });

  it('does not query or subscribe to store changes when disabled', () => {
    const { wrapper } = createQueryClientTestWrapper();
    const { result } = renderHook(() => useExistingDaysQuery(2026, 3, { enabled: false }), {
      wrapper,
    });

    window.dispatchEvent(
      new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
        detail: { operation: 'save', dates: ['2026-04-14'] },
      })
    );

    expect(result.current.data).toBeUndefined();
    expect(mockFetchExistingDaysInMonth).not.toHaveBeenCalled();
  });
  it('retains one subscription across rerenders and follows month, enabled state and unmount', async () => {
    mockFetchExistingDaysInMonth.mockResolvedValue([7]);
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const registrations = () =>
      add.mock.calls.filter(([event]) => event === DAILY_RECORD_STORE_CHANGED_EVENT).length;
    const removals = () =>
      remove.mock.calls.filter(([event]) => event === DAILY_RECORD_STORE_CHANGED_EVENT).length;
    const { queryClient, wrapper } = createQueryClientTestWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result, rerender, unmount } = renderHook(
      ({ year, month, enabled }) => useExistingDaysQuery(year, month, { enabled }),
      { wrapper, initialProps: { year: 2026, month: 3, enabled: true } }
    );
    await waitFor(() => expect(result.current.data).toEqual([7]));
    const initialRegistrations = registrations();
    for (let i = 0; i < 100; i++) rerender({ year: 2026, month: 3, enabled: true });
    expect(registrations() - initialRegistrations).toBe(0);
    expect(removals()).toBe(0);

    rerender({ year: 2027, month: 2, enabled: true });
    await waitFor(() => expect(mockFetchExistingDaysInMonth).toHaveBeenCalledWith(2027, 3));
    expect(registrations()).toBe(initialRegistrations + 1);
    expect(removals()).toBe(1);
    const notify = (date: string) =>
      window.dispatchEvent(
        new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
          detail: { operation: 'save', dates: [date] },
        })
      );
    notify('2026-04-14');
    expect(invalidate).not.toHaveBeenCalled();
    notify('2027-03-14');
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['existingDays', 2027, 2] });

    rerender({ year: 2027, month: 2, enabled: false });
    expect(removals()).toBe(2);
    notify('2027-03-15');
    expect(invalidate).toHaveBeenCalledTimes(1);
    rerender({ year: 2027, month: 2, enabled: true });
    expect(registrations()).toBe(initialRegistrations + 2);
    unmount();
    expect(removals()).toBe(3);
    notify('2027-03-16');
    expect(invalidate).toHaveBeenCalledTimes(1);
    queryClient.clear();
    vi.restoreAllMocks();
  });

  describe('saves to days that are already marked', () => {
    const renderMarkedMonth = async (marked: number[]) => {
      mockFetchExistingDaysInMonth.mockResolvedValue(marked);
      const { queryClient, wrapper } = createQueryClientTestWrapper();
      const view = renderHook(() => useExistingDaysQuery(2026, 3), { wrapper });
      await waitFor(() => expect(view.result.current.data).toEqual(marked));
      return { ...view, queryClient };
    };

    it('re-reads only the saved day while it still has a patient', async () => {
      mockDoStoredDaysHavePatientData.mockResolvedValue(true);
      const { result } = await renderMarkedMonth([7, 14]);

      for (let i = 0; i < 20; i += 1) {
        storeChanged({ operation: 'save', dates: ['2026-04-14'] });
      }
      await waitFor(() => expect(mockDoStoredDaysHavePatientData).toHaveBeenCalledTimes(20));

      expect(mockDoStoredDaysHavePatientData).toHaveBeenCalledWith(['2026-04-14']);
      expect(mockFetchExistingDaysInMonth).toHaveBeenCalledTimes(1);
      expect(result.current.data).toEqual([7, 14]);
    });

    it('rescans the month when the saved day no longer has a patient', async () => {
      mockDoStoredDaysHavePatientData.mockResolvedValue(false);
      const { result } = await renderMarkedMonth([7, 14]);
      mockFetchExistingDaysInMonth.mockResolvedValue([7]);

      storeChanged({ operation: 'save', dates: ['2026-04-14'] });

      await waitFor(() => expect(result.current.data).toEqual([7]));
      expect(mockFetchExistingDaysInMonth).toHaveBeenCalledTimes(2);
    });

    it('rescans the month when the re-read fails', async () => {
      mockDoStoredDaysHavePatientData.mockRejectedValue(new Error('synthetic read failure'));
      await renderMarkedMonth([7, 14]);

      storeChanged({ operation: 'save', dates: ['2026-04-14'] });

      await waitFor(() => expect(mockFetchExistingDaysInMonth).toHaveBeenCalledTimes(2));
    });

    it('checks only this month when one save spans several months', async () => {
      mockDoStoredDaysHavePatientData.mockResolvedValue(true);
      await renderMarkedMonth([7, 14]);

      storeChanged({ operation: 'save', dates: ['2026-03-31', '2026-04-07', '2026-04-14'] });

      await waitFor(() =>
        expect(mockDoStoredDaysHavePatientData).toHaveBeenCalledExactlyOnceWith([
          '2026-04-07',
          '2026-04-14',
        ])
      );
      expect(mockFetchExistingDaysInMonth).toHaveBeenCalledTimes(1);
    });

    it('rescans instead of re-reading one day while a month rescan is still running', async () => {
      const { queryClient, result } = await renderMarkedMonth([7, 14]);
      let finishStaleRescan!: (days: number[]) => void;
      mockFetchExistingDaysInMonth
        .mockReturnValueOnce(
          new Promise<number[]>(resolve => {
            finishStaleRescan = resolve;
          })
        )
        .mockResolvedValueOnce([7, 14]);

      // Day 14 is deleted (rescan starts), then saved again before that rescan returns.
      storeChanged({ operation: 'delete', dates: ['2026-04-14'] });
      await waitFor(() =>
        expect(queryClient.isFetching({ queryKey: ['existingDays', 2026, 3] })).toBe(1)
      );
      storeChanged({ operation: 'save', dates: ['2026-04-14'] });
      await act(async () => {
        finishStaleRescan([7]);
      });

      expect(mockDoStoredDaysHavePatientData).not.toHaveBeenCalled();
      await waitFor(() => expect(result.current.data).toEqual([7, 14]));
      expect(mockFetchExistingDaysInMonth).toHaveBeenCalledTimes(3);
    });

    it('rescans when the month has no markers yet because the first read failed', async () => {
      mockFetchExistingDaysInMonth.mockRejectedValueOnce(new Error('synthetic local failure'));
      const { queryClient, wrapper } = createQueryClientTestWrapper();
      const view = renderHook(() => useExistingDaysQuery(2026, 3), { wrapper });
      await waitFor(() => expect(view.result.current.isError).toBe(true));
      mockFetchExistingDaysInMonth.mockResolvedValue([14]);

      storeChanged({ operation: 'save', dates: ['2026-04-14'] });

      await waitFor(() => expect(view.result.current.data).toEqual([14]));
      expect(mockDoStoredDaysHavePatientData).not.toHaveBeenCalled();
      queryClient.clear();
    });

    it.each<[string, DailyRecordStoreChangedEventDetail]>([
      ['a save to an unmarked day', { operation: 'save', dates: ['2026-04-21'] }],
      [
        'a save that mixes marked and unmarked days',
        { operation: 'save', dates: ['2026-04-14', '2026-04-21'] },
      ],
      ['a delete of a marked day', { operation: 'delete', dates: ['2026-04-14'] }],
      ['a clear of the whole store', { operation: 'clear' }],
    ])('rescans the month for %s', async (_case, detail) => {
      const { queryClient } = await renderMarkedMonth([7, 14]);
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

      storeChanged(detail);

      expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: ['existingDays', 2026, 3] });
      expect(mockDoStoredDaysHavePatientData).not.toHaveBeenCalled();
      await waitFor(() => expect(mockFetchExistingDaysInMonth).toHaveBeenCalledTimes(2));
    });
  });
});
