import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useExistingDaysQuery } from '@/hooks/useExistingDaysQuery';
import { createQueryClientTestWrapper } from '@/tests/utils/queryClientTestUtils';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';

const mockFetchExistingDaysInMonth = vi.fn();

vi.mock('@/services/records/recordQueryService', () => ({
  fetchExistingDaysInMonth: (...args: unknown[]) => mockFetchExistingDaysInMonth(...args),
}));

describe('useExistingDaysQuery', () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => {
    vi.clearAllMocks();
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
});
