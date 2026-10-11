import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCudyrReport } from '@/features/cudyr/hooks/useCudyrReport';
import { buildCudyrReport } from '@/services/cudyr/cudyrReportModel';
import { reportInput } from '../../services/cudyr/reportFixtures';
const session = vi.hoisted(() => ({ owner: 'owner-a', generation: 'a' }));
vi.mock('@/services/storage/sessionScopedStorageService', () => ({
  getStoredSessionOwnerKey: () => session.owner,
}));
vi.mock('@/services/storage/sessionStorageTransition', () => ({
  getSessionGeneration: () => session.generation,
}));
vi.mock('@/services/cudyr/cudyrReportLoader', () => ({ loadCudyrReport: vi.fn() }));
const dataset = (from: string, to: string, version = 'v1') => ({
  ...buildCudyrReport(reportInput({ from, to })),
  coverage: [
    { date: to, state: 'disponible' as const, lastSyncedAt: '', runId: '', recordVersion: version },
  ],
});
beforeEach(() => {
  session.owner = 'owner-a';
  session.generation = 'a';
});
describe('CUDYR navigation cache', () => {
  it('reuses an official month across live census revisions but still verifies on refresh and expiry', async () => {
    const loader = vi.fn().mockImplementation(async (from, to) => ({
      ...dataset(from, to, 'approved-census'),
      officialSnapshot: { version: 'official-v1', savedAt: '2026-10-09T20:00:00Z' },
    }));
    const { result, rerender } = renderHook(
      ({ date, version }) => useCudyrReport(date, loader, { date, version }),
      { initialProps: { date: '2026-10-07', version: 'live-v1' } }
    );
    await waitFor(() => expect(result.current.busy).toBe(false));
    for (const [date, version] of [
      ['2026-10-06', 'live-v2'],
      ['2026-10-07', 'live-v3'],
      ['2026-10-07', 'live-v4'],
    ]) {
      rerender({ date, version });
      await waitFor(() => expect(result.current.data?.to).toBe(date));
      expect(result.current.busy).toBe(false);
    }
    expect(loader).toHaveBeenCalledTimes(1);
    expect(result.current.data?.officialSnapshot?.version).toBe('official-v1');
    await act(async () => result.current.load('2026-10-01', '2026-10-07'));
    expect(loader).toHaveBeenCalledTimes(2);
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse(result.current.data!.loadedAt!) + 120_001);
    try {
      rerender({ date: '2026-10-07', version: 'live-v5' });
      await waitFor(() => expect(loader).toHaveBeenCalledTimes(3));
      await waitFor(() => expect(result.current.busy).toBe(false));
    } finally {
      clock.mockRestore();
    }
  });
  it('returns to a loaded day without another server read, while explicit refresh reloads', async () => {
    const loader = vi.fn().mockImplementation(async (from, to) => dataset(from, to));
    const { result, rerender } = renderHook(({ date }) => useCudyrReport(date, loader), {
      initialProps: { date: '2026-10-06' },
    });
    await waitFor(() => expect(result.current.data?.to).toBe('2026-10-06'));
    rerender({ date: '2026-10-07' });
    await waitFor(() => expect(result.current.data?.to).toBe('2026-10-07'));
    rerender({ date: '2026-10-06' });
    await waitFor(() => expect(result.current.data?.to).toBe('2026-10-06'));
    expect(loader).toHaveBeenCalledTimes(2);
    expect(result.current.busy).toBe(false);
    await act(async () => result.current.load('2026-10-01', '2026-10-06'));
    expect(loader).toHaveBeenCalledTimes(3);
  });
  it('invalidates the cached day when its live census revision changes', async () => {
    let version = 'v1';
    const loader = vi.fn().mockImplementation(async (from, to) => dataset(from, to, version));
    const { result, rerender } = renderHook(
      ({ version }) => useCudyrReport('2026-10-06', loader, { date: '2026-10-06', version }),
      { initialProps: { version } }
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());
    version = 'v2';
    rerender({ version });
    await waitFor(() => expect(result.current.data?.coverage[0].recordVersion).toBe('v2'));
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it('does not reuse incomplete reads or reports from a previous session', async () => {
    const loader = vi.fn().mockImplementation(async (from, to) => ({
      ...dataset(from, to),
      issues: ['Lectura incompleta'],
    }));
    const { result, rerender } = renderHook(({ date }) => useCudyrReport(date, loader), {
      initialProps: { date: '2026-10-06' },
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    rerender({ date: '2026-10-07' });
    await waitFor(() => expect(result.current.data?.to).toBe('2026-10-07'));
    rerender({ date: '2026-10-06' });
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(3));
    session.owner = 'owner-b';
    session.generation = 'b';
    rerender({ date: '2026-10-06' });
    await waitFor(() => expect(loader).toHaveBeenCalledTimes(4));
  });
  it('invalidates for census deletion and recreation even without timestamps', async () => {
    let version = 'present:::';
    const loader = vi.fn().mockImplementation(async (from, to) => dataset(from, to, version));
    const { result, rerender } = renderHook(
      ({ version }) => useCudyrReport('2026-10-06', loader, { date: '2026-10-06', version }),
      { initialProps: { version } }
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());
    for (version of ['missing', 'present:::']) {
      rerender({ version });
      await waitFor(() => expect(result.current.data?.coverage[0].recordVersion).toBe(version));
    }
    expect(loader).toHaveBeenCalledTimes(3);
  });
});

it('shows the previous report immediately on reopening while Firebase verifies in the background', async () => {
  let finish: (value: ReturnType<typeof dataset>) => void;
  const loader = vi
    .fn()
    .mockImplementationOnce(async (from, to) => dataset(from, to))
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
  const first = renderHook(() => useCudyrReport('2026-10-06', loader));
  await waitFor(() => expect(first.result.current.data).not.toBeNull());
  first.unmount();
  const second = renderHook(() => useCudyrReport('2026-10-06', loader));
  expect(second.result.current.data?.to).toBe('2026-10-06');
  expect(second.result.current.busy).toBe(true);
  await act(async () => finish!(dataset('2026-10-01', '2026-10-06', 'new')));
  expect(second.result.current.data?.coverage[0].recordVersion).toBe('new');
});

it('projects an earlier day from a loaded monthly range without rereading Firebase', async () => {
  const loader = vi.fn().mockImplementation(async (from, to) => dataset(from, to));
  const { result, rerender } = renderHook(({ date }) => useCudyrReport(date, loader), {
    initialProps: { date: '2026-10-07' },
  });
  await waitFor(() => expect(result.current.data).not.toBeNull());
  rerender({ date: '2026-10-02' });
  await waitFor(() => expect(result.current.data?.to).toBe('2026-10-02'));
  expect(loader).toHaveBeenCalledTimes(1);
  expect(result.current.data?.rows.every(row => row.date <= '2026-10-02')).toBe(true);
});

it('retains the visible cached report if Firebase is unavailable on reopening', async () => {
  const loader = vi
    .fn()
    .mockImplementationOnce(async (from, to) => dataset(from, to))
    .mockRejectedValueOnce(new Error('Sin conexión'));
  const first = renderHook(() => useCudyrReport('2026-10-06', loader));
  await waitFor(() => expect(first.result.current.data).not.toBeNull());
  first.unmount();
  const second = renderHook(() => useCudyrReport('2026-10-06', loader));
  await waitFor(() => expect(second.result.current.error).toBe('Sin conexión'));
  expect(second.result.current.data?.to).toBe('2026-10-06');
});

it.each([
  [true, '2026-10-02'],
  [false, '2026-10-02'],
  [true, '2026-10-03'],
] as const)(
  'rereads Firebase on covered deadline when enabled=%s while viewing %s',
  async (refreshWindow, selectedDate) => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-03T11:59:59-05:00'));
      const loader = vi.fn().mockImplementation(async (from, to) => ({
        ...dataset(from, to),
        generatedAt: new Date().toISOString(),
        coverage: ['2026-10-02', to].map(date => ({
          date,
          state: 'disponible' as const,
          lastSyncedAt: '',
          runId: '',
        })),
        rows: buildCudyrReport(reportInput()).rows.map(row => ({
          ...row,
          date: '2026-10-02',
          applicationPending:
            new Date().getTime() < new Date('2026-10-03T12:00:00-05:00').getTime(),
        })),
      }));
      const { result, unmount } = renderHook(() =>
        useCudyrReport(selectedDate, loader, undefined, refreshWindow)
      );
      await act(async () => {});
      expect(result.current.data?.rows[0].applicationPending).toBe(true);
      await act(async () => vi.advanceTimersByTime(1000));
      expect(result.current.data?.rows[0].applicationPending).toBe(!refreshWindow);
      if (!refreshWindow)
        expect(result.current.data?.generatedAt).toBe(
          new Date('2026-10-03T11:59:59-05:00').toISOString()
        );
      expect(loader).toHaveBeenCalledTimes(refreshWindow ? 2 : 1);
      unmount();
    } finally {
      vi.useRealTimers();
    }
  }
);

it('re-verifies a cached prefix after a failed background read, even inside the freshness interval', async () => {
  const loader = vi.fn().mockImplementationOnce(async (from, to) => dataset(from, to));
  const first = renderHook(() => useCudyrReport('2026-10-07', loader));
  await waitFor(() => expect(first.result.current.data).not.toBeNull());
  first.unmount();
  loader.mockRejectedValueOnce(new Error('Sin conexión'));
  const second = renderHook(({ date }) => useCudyrReport(date, loader), {
    initialProps: { date: '2026-10-07' },
  });
  await waitFor(() => expect(second.result.current.error).toBe('Sin conexión'));
  let finish: (value: ReturnType<typeof dataset>) => void;
  loader.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  second.rerender({ date: '2026-10-02' });
  expect(second.result.current.data?.to).toBe('2026-10-02');
  expect(second.result.current.busy).toBe(true);
  expect(loader).toHaveBeenCalledTimes(3);
  await act(async () => finish(dataset('2026-10-01', '2026-10-02')));
  expect(second.result.current.busy).toBe(false);
});

it('retains the last good cache across a failed forced refresh and reopening', async () => {
  const loader = vi.fn().mockImplementationOnce(async (from, to) => dataset(from, to));
  const first = renderHook(() => useCudyrReport('2026-10-07', loader));
  await waitFor(() => expect(first.result.current.data).not.toBeNull());
  loader.mockRejectedValueOnce(new Error('Sin conexión'));
  await act(async () => first.result.current.load('2026-10-01', '2026-10-07'));
  expect(first.result.current.error).toBe('Sin conexión');
  first.unmount();
  loader.mockImplementationOnce(() => new Promise(() => {}));
  const second = renderHook(() => useCudyrReport('2026-10-07', loader));
  expect(second.result.current.data?.to).toBe('2026-10-07');
  expect(second.result.current.busy).toBe(true);
  expect(loader).toHaveBeenCalledTimes(3);
  second.unmount();
});

it('retains all cached rows and blocks verification on a resolved partial Firebase read', async () => {
  const loader = vi.fn().mockImplementationOnce(async (from, to) => dataset(from, to));
  const view = renderHook(() => useCudyrReport('2026-10-07', loader));
  await waitFor(() => expect(view.result.current.data).not.toBeNull());
  const original = view.result.current.data!.rows;
  loader.mockResolvedValueOnce({
    ...dataset('2026-10-01', '2026-10-07'),
    rows: [],
    issues: ['Lectura incompleta'],
  });
  await act(async () => view.result.current.load('2026-10-01', '2026-10-07'));
  expect(view.result.current.data?.rows).toEqual(original);
  expect(view.result.current.error).toContain('Se conserva la copia anterior');
});

it('keeps cached official rows visible but busy until remote verification completes', async () => {
  const data = {
    ...dataset('2026-10-01', '2026-10-06'),
    officialSnapshot: { version: 'v1', savedAt: '2026-10-09T20:00:00Z' },
  };
  let finish: (value: typeof data) => void;
  const loader = vi
    .fn()
    .mockResolvedValueOnce(data)
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
  const first = renderHook(() => useCudyrReport('2026-10-06', loader));
  await waitFor(() => expect(first.result.current.busy).toBe(false));
  first.unmount();
  const second = renderHook(() => useCudyrReport('2026-10-06', loader));
  expect(second.result.current.data?.officialSnapshot).toEqual(data.officialSnapshot);
  expect(second.result.current.busy).toBe(true);
  await act(async () => finish!(data));
  expect(second.result.current.busy).toBe(false);
});
