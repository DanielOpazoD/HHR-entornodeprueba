import {
  createDailyRecordQueryFn,
  getDailyRecordQueryKey,
} from '@/hooks/controllers/dailyRecordQueryController';
import { createNotFoundDailyRecordReadResult } from '@/services/repositories/dailyRecordReadResultController';
import { resolveDailyRecordBootstrapPhase } from '@/hooks/controllers/dailyRecordBootstrapController';
import { QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient as appQueryClient } from '@/config/queryClient';
import {
  getDailyRecordFreshnessStatus,
  markDailyRecordTabHidden,
  markDailyRecordTabVisible,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { useDailyRecordQuery } from '@/hooks/useDailyRecordQuery';
import { RepositoryProvider, createRepositoryContainer } from '@/services/RepositoryContext';
import { createDailyRecordReadResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createTestQueryClient } from '@/tests/utils/queryClientTestUtils';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';

const createWrapper = (
  dailyRecord: DailyRecordRepositoryPort,
  queryClient = createTestQueryClient()
) => {
  const repositories = createRepositoryContainer({ dailyRecord });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <RepositoryProvider value={repositories}>{children}</RepositoryProvider>
    </QueryClientProvider>
  );
  wrapper.displayName = 'DailyRecordQueryTestWrapper';

  return wrapper;
};

describe('useDailyRecordQuery', () => {
  const date = '2026-04-03';
  const mockRecord: DailyRecord = DataFactory.createMockDailyRecord(date, {
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    nurses: [],
    activeExtraBeds: [],
  });

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-03T12:00:00.000Z'));
    setFirestoreEnabled(true);
    resetDailyRecordFreshnessGateForTests();
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    cleanup();
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('does not renew freshness when mounting a previously confirmed query cache', async () => {
    const client = createTestQueryClient({ defaultOptions: appQueryClient.getDefaultOptions() });
    const repository = buildMockDailyRecordRepository();
    const confirmed = createDailyRecordReadResult(date, mockRecord, 'firestore', {
      serverConfirmed: true,
    });
    const cached = await createDailyRecordQueryFn(
      { getForDateWithMeta: vi.fn().mockResolvedValue(confirmed) },
      date
    )();
    client.setQueryData(getDailyRecordQueryKey(date), cached);
    vi.mocked(repository.getForDateWithMeta).mockImplementation(() => new Promise(() => {}));
    markDailyRecordTabHidden(0);
    markDailyRecordTabVisible(360_000);

    const { result } = renderHook(() => useDailyRecordQuery(date, false, 'ready'), {
      wrapper: createWrapper(repository, client),
    });

    expect(result.current.data).toEqual(mockRecord);
    expect(getDailyRecordFreshnessStatus(date)).toBe('stale_due_to_inactivity');
  });

  it('revalidates a fresh cached absence before allowing empty UI on a new visit', async () => {
    const client = createTestQueryClient({ defaultOptions: appQueryClient.getDefaultOptions() });
    const cached = await createDailyRecordQueryFn(
      {
        getForDateWithMeta: vi
          .fn()
          .mockResolvedValue(createNotFoundDailyRecordReadResult(date, 'missing')),
      },
      date
    )();
    client.setQueryData(getDailyRecordQueryKey(date), cached);
    let release!: (value: ReturnType<typeof createDailyRecordReadResult>) => void;
    const repository = buildMockDailyRecordRepository();
    vi.mocked(repository.getForDateWithMeta).mockImplementation(
      () =>
        new Promise(resolve => {
          release = resolve;
        })
    );
    const phases: string[] = [];
    const { result } = renderHook(
      () => {
        const query = useDailyRecordQuery(date, false, 'ready');
        phases.push(
          resolveDailyRecordBootstrapPhase({
            remoteSyncStatus: 'ready',
            record: query.data,
            runtime: query.runtime,
            currentDateString: date,
            isFetching: query.isFetching,
            gracePeriodExpired: false,
          })
        );
        return query;
      },
      { wrapper: createWrapper(repository, client) }
    );
    expect(result.current.isFetching).toBe(true);
    expect(phases).not.toContain('confirmed_empty');
    await act(async () => {
      release(
        createDailyRecordReadResult(date, mockRecord, 'firestore', { serverConfirmed: true })
      );
    });
    await waitFor(() => expect(result.current.data).toEqual(mockRecord));
    expect(phases).not.toContain('confirmed_empty');
    expect(phases).toContain('record_ready');
  });

  it.each([
    { scenario: 'brief tab return', elapsed: 1000, reconnect: false, reads: 1 },
    { scenario: 'stale tab return', elapsed: 360000, reconnect: false, reads: 2 },
    {
      scenario: 'expired query after brief absence',
      elapsed: 360000,
      hiddenFor: 1000,
      reconnect: false,
      reads: 2,
    },
    { scenario: 'brief connection loss', elapsed: 1000, reconnect: true, reads: 2 },
    { scenario: 'stale connection loss', elapsed: 360000, reconnect: true, reads: 2 },
  ])(
    'counts repository reads on $scenario with the real query client',
    async ({ elapsed, hiddenFor, reconnect, reads }) => {
      const dailyRecord = buildMockDailyRecordRepository();
      const queryClient = createTestQueryClient({
        defaultOptions: appQueryClient.getDefaultOptions(),
      });
      vi.mocked(dailyRecord.getForDateWithMeta).mockResolvedValue(
        createDailyRecordReadResult(date, mockRecord, 'firestore', { serverConfirmed: true })
      );
      const { result, unmount } = renderHook(() => useDailyRecordQuery(date, false, 'ready'), {
        wrapper: createWrapper(dailyRecord, queryClient),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(dailyRecord.getForDateWithMeta).toHaveBeenCalledTimes(1);
      const startedAt = Date.parse('2026-04-03T12:00:00.000Z');
      act(() => {
        if (reconnect) onlineManager.setOnline(false);
        else {
          focusManager.setFocused(false);
          markDailyRecordTabHidden(startedAt + elapsed - (hiddenFor ?? elapsed));
        }
      });
      vi.spyOn(Date, 'now').mockReturnValue(startedAt + elapsed);
      await act(async () => {
        if (reconnect) {
          onlineManager.setOnline(true);
          window.dispatchEvent(new Event('online'));
        } else {
          focusManager.setFocused(true);
          window.dispatchEvent(new Event('focus'));
        }
      });
      await waitFor(() => {
        expect(dailyRecord.getForDateWithMeta).toHaveBeenCalledTimes(reads);
        expect(result.current.isFetching).toBe(false);
      });
      expect(result.current.data).toEqual(mockRecord);
      expect(dailyRecord.subscribeDetailed).toHaveBeenCalledTimes(1);
      unmount();
      queryClient.clear();
    }
  );

  it('reads the daily record locally when remote sync is not ready', async () => {
    const dailyRecord = buildMockDailyRecordRepository();
    vi.mocked(dailyRecord.getForDateWithMeta).mockResolvedValue(
      createDailyRecordReadResult(date, mockRecord, 'indexeddb')
    );

    const { result } = renderHook(() => useDailyRecordQuery(date, false, 'local_only'), {
      wrapper: createWrapper(dailyRecord),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(mockRecord);
    });

    expect(dailyRecord.getForDateWithMeta).toHaveBeenCalledWith(date, false);
    expect(dailyRecord.subscribe).not.toHaveBeenCalled();
    expect(dailyRecord.subscribeDetailed).not.toHaveBeenCalled();
  });

  it('subscribes to realtime updates only when remote sync is ready', async () => {
    const dailyRecord = buildMockDailyRecordRepository();
    vi.mocked(dailyRecord.getForDateWithMeta).mockResolvedValue(
      createDailyRecordReadResult(date, mockRecord, 'firestore', { serverConfirmed: true })
    );

    const { result } = renderHook(() => useDailyRecordQuery(date, false, 'ready'), {
      wrapper: createWrapper(dailyRecord),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(mockRecord);
    });

    expect(dailyRecord.getForDateWithMeta).toHaveBeenCalledWith(date, true);
    expect(dailyRecord.subscribeDetailed).toHaveBeenCalledWith(date, expect.any(Function));
  });

  it('keeps one live listener and releases it on date, offline, and unmount transitions', async () => {
    const dailyRecord = buildMockDailyRecordRepository();
    const queryClient = createTestQueryClient();
    const activeDates = new Set<string>();
    const stops: Array<ReturnType<typeof vi.fn>> = [];
    vi.mocked(dailyRecord.getForDateWithMeta).mockImplementation(async requestedDate =>
      createDailyRecordReadResult(
        requestedDate,
        DataFactory.createMockDailyRecord(requestedDate),
        'firestore',
        { serverConfirmed: true }
      )
    );
    vi.mocked(dailyRecord.subscribeDetailed).mockImplementation(requestedDate => {
      activeDates.add(requestedDate);
      const stop = vi.fn(() => activeDates.delete(requestedDate));
      stops.push(stop);
      return stop;
    });

    const { rerender, unmount } = renderHook(
      ({ selectedDate, offline }: { selectedDate: string; offline: boolean }) =>
        useDailyRecordQuery(selectedDate, offline, 'ready'),
      {
        initialProps: { selectedDate: date, offline: false },
        wrapper: createWrapper(dailyRecord, queryClient),
      }
    );

    await waitFor(() => expect(activeDates).toEqual(new Set([date])));
    rerender({ selectedDate: date, offline: false });
    expect(dailyRecord.subscribeDetailed).toHaveBeenCalledTimes(1);
    expect(stops[0]).not.toHaveBeenCalled();

    const nextDate = '2026-04-04';
    rerender({ selectedDate: nextDate, offline: false });
    await waitFor(() => expect(activeDates).toEqual(new Set([nextDate])));
    expect(stops[0]).toHaveBeenCalledTimes(1);
    expect(dailyRecord.subscribeDetailed).toHaveBeenCalledTimes(2);

    rerender({ selectedDate: nextDate, offline: true });
    expect(activeDates.size).toBe(0);
    expect(stops[1]).toHaveBeenCalledTimes(1);

    rerender({ selectedDate: nextDate, offline: false });
    await waitFor(() => expect(activeDates).toEqual(new Set([nextDate])));
    expect(dailyRecord.subscribeDetailed).toHaveBeenCalledTimes(3);

    unmount();
    expect(activeDates.size).toBe(0);
    expect(stops[2]).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });

  it('refetches from remote when the runtime transitions from local_only to ready', async () => {
    const dailyRecord = buildMockDailyRecordRepository();
    const initialProps: { remoteSyncStatus: 'local_only' | 'ready' } = {
      remoteSyncStatus: 'local_only',
    };
    vi.mocked(dailyRecord.getForDateWithMeta).mockImplementation(
      async (_date: string, syncFromRemote?: boolean) =>
        createDailyRecordReadResult(
          date,
          syncFromRemote ? mockRecord : null,
          syncFromRemote ? 'firestore' : 'not_found'
        )
    );

    const { result, rerender } = renderHook(
      ({ remoteSyncStatus }: { remoteSyncStatus: 'local_only' | 'ready' }) =>
        useDailyRecordQuery(date, false, remoteSyncStatus),
      {
        initialProps,
        wrapper: createWrapper(dailyRecord),
      }
    );

    await waitFor(() => {
      expect(dailyRecord.getForDateWithMeta).toHaveBeenCalledWith(date, false);
    });
    expect(result.current.data).toBeNull();

    vi.mocked(dailyRecord.getForDateWithMeta).mockClear();

    rerender({ remoteSyncStatus: 'ready' });

    await waitFor(() => {
      expect(dailyRecord.getForDateWithMeta).toHaveBeenCalledWith(date, true);
      expect(result.current.data).toEqual(mockRecord);
    });
  });
  it('opens the live listener while the first read is still deferred to local data', async () => {
    const dailyRecord = buildMockDailyRecordRepository();
    vi.mocked(dailyRecord.getForDateWithMeta).mockResolvedValue(
      createDailyRecordReadResult(date, mockRecord, 'indexeddb')
    );

    const { result } = renderHook(() => useDailyRecordQuery(date, false, 'local_only', 'ready'), {
      wrapper: createWrapper(dailyRecord),
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(mockRecord);
    });

    // The census still renders from local data, but the server connection is
    // no longer held back by the deferred hydration window.
    expect(dailyRecord.getForDateWithMeta).toHaveBeenCalledWith(date, false);
    expect(dailyRecord.subscribeDetailed).toHaveBeenCalledWith(date, expect.any(Function));
  });

  it('keeps the listener closed when the runtime itself is not ready', async () => {
    const dailyRecord = buildMockDailyRecordRepository();
    vi.mocked(dailyRecord.getForDateWithMeta).mockResolvedValue(
      createDailyRecordReadResult(date, mockRecord, 'indexeddb')
    );

    const { result } = renderHook(
      () => useDailyRecordQuery(date, false, 'local_only', 'local_only'),
      { wrapper: createWrapper(dailyRecord) }
    );

    await waitFor(() => {
      expect(result.current.data).toEqual(mockRecord);
    });

    expect(dailyRecord.subscribeDetailed).not.toHaveBeenCalled();
    expect(dailyRecord.subscribe).not.toHaveBeenCalled();
  });

  it('prefetches the previous day once per selected day, not on every live update', async () => {
    vi.stubEnv('DEV', false);
    const dailyRecord = buildMockDailyRecordRepository();
    const queryClient = createTestQueryClient();
    vi.mocked(dailyRecord.getForDateWithMeta).mockImplementation(async requestedDate =>
      createDailyRecordReadResult(
        requestedDate,
        DataFactory.createMockDailyRecord(requestedDate),
        'firestore',
        { serverConfirmed: true }
      )
    );
    const remoteReadsOf = (requestedDate: string) =>
      vi
        .mocked(dailyRecord.getForDateWithMeta)
        .mock.calls.filter(([readDate, fromRemote]) => readDate === requestedDate && fromRemote)
        .length;
    const { result, rerender } = renderHook(
      ({ selectedDate }: { selectedDate: string }) =>
        useDailyRecordQuery(selectedDate, false, 'ready'),
      { initialProps: { selectedDate: date }, wrapper: createWrapper(dailyRecord, queryClient) }
    );
    // Each live update lands past the 5-minute stale window and is rendered before the
    // next one, so a prefetch on every update would show up as one more read each time.
    let now = Date.parse('2026-04-03T12:00:00.000Z');
    const liveUpdates = async (selectedDate: string, count: number) => {
      for (let i = 0; i < count; i += 1) {
        now += 6 * 60 * 1000;
        vi.spyOn(Date, 'now').mockReturnValue(now);
        const lastUpdated = new Date(now).toISOString();
        act(() => {
          queryClient.setQueryData(getDailyRecordQueryKey(selectedDate), (previous: unknown) => {
            const current = previous as { record: DailyRecord };
            return { ...current, record: { ...current.record, lastUpdated } };
          });
        });
        await waitFor(() => expect(result.current.data?.lastUpdated).toBe(lastUpdated));
        await waitFor(() => expect(queryClient.isFetching()).toBe(0));
      }
    };

    await waitFor(() => expect(remoteReadsOf('2026-04-02')).toBe(1));
    await liveUpdates(date, 10);
    expect(remoteReadsOf('2026-04-02')).toBe(1);

    const callsBeforeNextDay = remoteReadsOf(date);
    now += 6 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    rerender({ selectedDate: '2026-04-04' });
    await waitFor(() => expect(remoteReadsOf(date)).toBe(callsBeforeNextDay + 1));
    await liveUpdates('2026-04-04', 10);
    expect(remoteReadsOf(date)).toBe(callsBeforeNextDay + 1);
    expect(remoteReadsOf('2026-04-02')).toBe(1);
    queryClient.clear();
  });
});
