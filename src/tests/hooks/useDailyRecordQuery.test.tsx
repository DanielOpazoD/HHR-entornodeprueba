import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  getMonthRecords: vi.fn(),
  initializeDay: vi.fn(),
  save: vi.fn(),
  saveDetailed: vi.fn(),
  updatePartial: vi.fn(),
  updatePartialDetailed: vi.fn(),
  syncWithFirestoreDetailed: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
  subscribeDetailed: vi.fn(() => vi.fn()),
  delete: vi.fn(),
  deleteDay: vi.fn(),
  copyPatientToDateDetailed: vi.fn(),
});

const createWrapper = (dailyRecord: DailyRecordRepositoryPort) => {
  const queryClient = createTestQueryClient();
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
  });

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
});
