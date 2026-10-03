import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCensusPromptState } from '@/hooks/useCensusPromptState';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';

const { previous, dates } = vi.hoisted(() => ({ previous: vi.fn(), dates: vi.fn() }));
vi.mock('@/application/ports/dailyRecordPort', () => ({
  defaultDailyRecordReadPort: { getPreviousDay: previous, getRecentAvailableDates: dates },
}));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
};
const changed = () =>
  window.dispatchEvent(
    new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
      detail: { operation: 'save', dates: ['2026-02-14'] },
    })
  );

describe('census prompt reads on demand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previous.mockResolvedValue({ date: '2026-02-14' });
    dates.mockResolvedValue(['2026-02-14']);
  });

  it('does not read copy sources on populated mount, reload or date changes', async () => {
    const first = renderHook(({ date }) => useCensusPromptState(date, false), {
      initialProps: { date: '2026-02-15' },
    });
    await act(async () => {
      changed();
    });
    first.rerender({ date: '2026-02-16' });
    first.unmount();
    renderHook(() => useCensusPromptState('2026-02-16', false));
    await act(async () => {
      changed();
    });
    expect(previous).not.toHaveBeenCalled();
    expect(dates).not.toHaveBeenCalled();
  });

  it('loads both sources when an empty day needs them and stops on a populated day', async () => {
    const view = renderHook(({ enabled }) => useCensusPromptState('2026-02-15', enabled), {
      initialProps: { enabled: false },
    });
    view.rerender({ enabled: true });
    await waitFor(() => expect(view.result.current.previousRecordAvailable).toBe(true));
    expect(previous).toHaveBeenCalledTimes(1);
    expect(dates).toHaveBeenCalledWith('2026-02-15');
    view.rerender({ enabled: false });
    await act(async () => {
      changed();
    });
    expect(previous).toHaveBeenCalledTimes(1);
    expect(view.result.current.availableDates).toEqual([]);
    const fresh = deferred<{ date: string } | null>();
    previous.mockImplementationOnce(() => fresh.promise);
    dates.mockResolvedValueOnce([]);
    view.rerender({ enabled: true });
    expect(view.result.current.previousRecordAvailable).toBe(false);
    expect(view.result.current.availableDates).toEqual([]);
    await act(async () => {
      fresh.resolve(null);
    });
    expect(previous).toHaveBeenCalledTimes(2);
    expect(view.result.current.previousRecordAvailable).toBe(false);
  });

  it('ignores a response from a disabled or older day and exposes no stale copy date', async () => {
    const old = deferred<{ date: string }>();
    const current = deferred<{ date: string }>();
    previous
      .mockImplementationOnce(() => old.promise)
      .mockImplementationOnce(() => current.promise);
    const view = renderHook(({ date, enabled }) => useCensusPromptState(date, enabled), {
      initialProps: { date: '2026-02-15', enabled: true },
    });
    view.rerender({ date: '2026-02-16', enabled: false });
    await act(async () => {
      old.resolve({ date: '2026-02-14' });
    });
    expect(view.result.current.previousRecordAvailable).toBe(false);
    dates.mockResolvedValue(['2026-02-15']);
    view.rerender({ date: '2026-02-16', enabled: true });
    expect(view.result.current.availableDates).toEqual([]);
    await act(async () => {
      current.resolve({ date: '2026-02-15' });
    });
    await waitFor(() => expect(view.result.current.previousRecordDate).toBe('2026-02-15'));
  });

  it('defaults to enabled, ignores current-day writes and refreshes after another day changes', async () => {
    const view = renderHook(() => useCensusPromptState('2026-02-15'));
    await waitFor(() => expect(view.result.current.previousRecordAvailable).toBe(true));
    expect(previous).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
          detail: { operation: 'save', dates: ['2026-02-15'] },
        })
      );
    });
    expect(previous).toHaveBeenCalledTimes(1);
    previous.mockResolvedValueOnce(null);
    dates.mockResolvedValueOnce([]);
    await act(async () => {
      changed();
    });
    await waitFor(() => expect(view.result.current.previousRecordAvailable).toBe(false));
    expect(previous).toHaveBeenCalledTimes(2);
  });

  it('ignores an older date response that arrives after the new date is already ready', async () => {
    const old = deferred<{ date: string }>();
    previous
      .mockImplementationOnce(() => old.promise)
      .mockResolvedValueOnce({ date: '2026-02-15' });
    const view = renderHook(({ date }) => useCensusPromptState(date), {
      initialProps: { date: '2026-02-15' },
    });
    dates.mockResolvedValueOnce(['2026-02-15']);
    view.rerender({ date: '2026-02-16' });
    await waitFor(() => expect(view.result.current.previousRecordDate).toBe('2026-02-15'));
    await act(async () => {
      old.resolve({ date: '2026-02-14' });
    });
    expect(view.result.current.previousRecordDate).toBe('2026-02-15');
    expect(view.result.current.availableDates).toEqual(['2026-02-15']);
  });
});
