import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCensusPromptState } from '@/hooks/useCensusPromptState';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';

const { local, remote, previous, dates } = vi.hoisted(() => ({
  local: vi.fn(),
  remote: vi.fn(),
  previous: vi.fn(),
  dates: vi.fn(),
}));
vi.mock('@/application/ports/dailyRecordPort', () => ({
  defaultDailyRecordReadPort: {
    getLocalForDate: local,
    getForDate: remote,
    getPreviousDay: previous,
    getRecentAvailableDates: dates,
  },
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

describe('census prompt reads only yesterday, on demand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    local.mockResolvedValue({ date: '2026-02-14' });
    remote.mockResolvedValue(null);
  });

  it('never lists the recent census window nor scans for an earlier day', async () => {
    const view = renderHook(() => useCensusPromptState('2026-02-15'));
    await waitFor(() => expect(view.result.current.previousRecordAvailable).toBe(true));
    expect(dates).not.toHaveBeenCalled();
    expect(previous).not.toHaveBeenCalled();
    expect(view.result.current.availableDates).toEqual([]);
  });

  it('answers from the device when yesterday is local, without a server read', async () => {
    const view = renderHook(() => useCensusPromptState('2026-02-15'));
    await waitFor(() => expect(view.result.current.previousRecordDate).toBe('2026-02-14'));
    expect(local).toHaveBeenCalledExactlyOnceWith('2026-02-14');
    expect(remote).not.toHaveBeenCalled();
  });

  it('reads only yesterday from the server when the device lacks it', async () => {
    local.mockResolvedValue(null);
    remote.mockResolvedValue({ date: '2026-02-14' });
    const view = renderHook(() => useCensusPromptState('2026-02-15'));
    await waitFor(() => expect(view.result.current.previousRecordAvailable).toBe(true));
    expect(remote).toHaveBeenCalledExactlyOnceWith('2026-02-14');
  });

  it.each([
    ['yesterday does not exist anywhere', () => remote.mockResolvedValue(null)],
    ['the server read fails', () => remote.mockRejectedValue(new Error('synthetic offline'))],
  ])('offers no copy when %s', async (_case, arrange) => {
    local.mockResolvedValue(null);
    arrange();
    const view = renderHook(() => useCensusPromptState('2026-02-15'));
    await waitFor(() => expect(remote).toHaveBeenCalledOnce());
    expect(view.result.current.previousRecordAvailable).toBe(false);
    expect(view.result.current.previousRecordDate).toBeUndefined();
  });

  it('does not read on populated mount, reload or date changes', async () => {
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
    expect(local).not.toHaveBeenCalled();
    expect(remote).not.toHaveBeenCalled();
  });

  it('reads when an empty day needs it, stops on a populated day, and hides stale answers', async () => {
    const view = renderHook(({ enabled }) => useCensusPromptState('2026-02-15', enabled), {
      initialProps: { enabled: false },
    });
    view.rerender({ enabled: true });
    await waitFor(() => expect(view.result.current.previousRecordAvailable).toBe(true));
    expect(local).toHaveBeenCalledTimes(1);
    view.rerender({ enabled: false });
    await act(async () => {
      changed();
    });
    expect(local).toHaveBeenCalledTimes(1);
    const fresh = deferred<{ date: string } | null>();
    local.mockImplementationOnce(() => fresh.promise);
    view.rerender({ enabled: true });
    expect(view.result.current.previousRecordAvailable).toBe(false);
    await act(async () => {
      fresh.resolve(null);
    });
    expect(local).toHaveBeenCalledTimes(2);
    expect(view.result.current.previousRecordAvailable).toBe(false);
  });

  it('ignores a response from a disabled or older day and exposes no stale copy date', async () => {
    const old = deferred<{ date: string }>();
    const current = deferred<{ date: string }>();
    local.mockImplementationOnce(() => old.promise).mockImplementationOnce(() => current.promise);
    const view = renderHook(({ date, enabled }) => useCensusPromptState(date, enabled), {
      initialProps: { date: '2026-02-15', enabled: true },
    });
    view.rerender({ date: '2026-02-16', enabled: false });
    await act(async () => {
      old.resolve({ date: '2026-02-14' });
    });
    expect(view.result.current.previousRecordAvailable).toBe(false);
    view.rerender({ date: '2026-02-16', enabled: true });
    await act(async () => {
      current.resolve({ date: '2026-02-15' });
    });
    await waitFor(() => expect(view.result.current.previousRecordDate).toBe('2026-02-15'));
  });

  it('ignores current-day writes and refreshes after yesterday changes', async () => {
    const view = renderHook(() => useCensusPromptState('2026-02-15'));
    await waitFor(() => expect(view.result.current.previousRecordAvailable).toBe(true));
    expect(local).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(DAILY_RECORD_STORE_CHANGED_EVENT, {
          detail: { operation: 'save', dates: ['2026-02-15'] },
        })
      );
    });
    expect(local).toHaveBeenCalledTimes(1);
    local.mockResolvedValueOnce(null);
    await act(async () => {
      changed();
    });
    await waitFor(() => expect(view.result.current.previousRecordAvailable).toBe(false));
    expect(local).toHaveBeenCalledTimes(2);
  });

  it('ignores an older date response that arrives after the new date is already ready', async () => {
    const old = deferred<{ date: string }>();
    local.mockImplementationOnce(() => old.promise).mockResolvedValueOnce({ date: '2026-02-15' });
    const view = renderHook(({ date }) => useCensusPromptState(date), {
      initialProps: { date: '2026-02-15' },
    });
    view.rerender({ date: '2026-02-16' });
    await waitFor(() => expect(view.result.current.previousRecordDate).toBe('2026-02-15'));
    await act(async () => {
      old.resolve({ date: '2026-02-14' });
    });
    expect(view.result.current.previousRecordDate).toBe('2026-02-15');
  });
});
