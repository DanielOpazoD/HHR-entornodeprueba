import { QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient as appQueryClient } from '@/config/queryClient';
import {
  markDailyRecordTabHidden,
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

const buildMockDailyRecordRepository = (): DailyRecordRepositoryPort => ({
  getForDate: vi.fn(),
  getForDateWithMeta: vi.fn(),
  getAuthoritativeForDate: vi.fn(),
  getLocalForDate: vi.fn(),
  getLocalForDateWithMeta: vi.fn(),
  getPreviousDay: vi.fn(),
  getPreviousDayWithMeta: vi.fn(),
  getAvailableDates: vi.fn(),
  getRecentAvailableDates: vi.fn(),
  getMonthRecords: vi.fn(),
  initializeDay: vi.fn(),
  save: vi.fn(),
  saveDetailed: vi.fn(),
  updatePartial: vi.fn(),
  updatePartialDetailed: vi.fn(),
  syncWithFirestoreDetailed: vi.fn(),
  adoptAuthoritativeRecord: vi.fn(async record => record),
  subscribe: vi.fn(() => vi.fn()),
  subscribeDetailed: vi.fn(() => vi.fn()),
  delete: vi.fn(),
  deleteDay: vi.fn(),
  copyPatientToDateDetailed: vi.fn(),
});

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
        createDailyRecordReadResult(date, mockRecord, 'firestore')
      );
      const { result, unmount } = renderHook(() => useDailyRecordQuery(date, false, 'ready'), {
        wrapper: createWrapper(dailyRecord, queryClient),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(dailyRecord.getForDateWithMeta).toHaveBeenCalledTimes(1);
      const startedAt = Date.now();
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
        // Drain QueryClient's async manager callbacks and React notifications.
        await new Promise(resolve => setTimeout(resolve, 20));
      });
      expect(result.current.isFetching).toBe(false);
      expect(result.current.data).toEqual(mockRecord);
      expect(dailyRecord.getForDateWithMeta).toHaveBeenCalledTimes(reads);
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
      createDailyRecordReadResult(date, mockRecord, 'firestore')
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
});
