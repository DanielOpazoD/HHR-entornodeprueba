import { renderHook } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDailyRecordFreshnessStatus,
  markDailyRecordTabHidden,
  markDailyRecordTabVisible,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { ensureFreshDailyRecordQuery } from '@/hooks/controllers/dailyRecordMutationFreshnessController';
import { useDailyRecordFreshnessRecovery } from '@/hooks/useDailyRecordFreshnessRecovery';
import { createDailyRecordReadResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import { DataFactory } from '@/tests/factories/DataFactory';

const date = '2026-05-16';
const record = DataFactory.createMockDailyRecord(date);
const unavailableRead = () =>
  createDailyRecordReadResult(date, record, 'indexeddb', {
    serverConfirmed: false,
    consistencyState: 'unavailable',
  });
const confirmedRead = () =>
  createDailyRecordReadResult(date, record, 'firestore', {
    serverConfirmed: true,
    sourceOfTruth: 'remote',
    consistencyState: 'remote_authoritative',
  });

describe('freshness check that could not confirm', () => {
  let visibility: DocumentVisibilityState;
  let queryClient: QueryClient;
  const reads = vi.fn();
  const dailyRecord = { ...buildMockDailyRecordRepository(), getForDateWithMeta: reads };

  const blockAfterReturningToTheTab = async () => {
    reads.mockResolvedValueOnce(unavailableRead());
    markDailyRecordTabHidden(0);
    markDailyRecordTabVisible(6 * 60 * 1000);
    await ensureFreshDailyRecordQuery(date, { dailyRecord, queryClient }, 'resume').catch(() => {});
    expect(getDailyRecordFreshnessStatus(date)).toBe('blocked_until_remote_check');
    reads.mockClear();
  };
  const recover = () =>
    renderHook(() => useDailyRecordFreshnessRecovery(date, true, dailyRecord, queryClient));

  beforeEach(() => {
    vi.useFakeTimers();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    queryClient = new QueryClient();
    resetDailyRecordFreshnessGateForTests();
    reads.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    queryClient.clear();
    resetDailyRecordFreshnessGateForTests();
  });

  it('reopens editing by itself once the server answers', async () => {
    await blockAfterReturningToTheTab();
    reads.mockResolvedValue(confirmedRead());

    const { unmount } = recover();
    await vi.advanceTimersByTimeAsync(3_000);

    expect(reads).toHaveBeenCalledTimes(1);
    expect(getDailyRecordFreshnessStatus(date)).toBe('fresh_remote_confirmed');

    await vi.advanceTimersByTimeAsync(120_000);
    expect(reads).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('keeps trying, spacing the attempts out, while the server does not answer', async () => {
    await blockAfterReturningToTheTab();
    reads.mockResolvedValue(unavailableRead());

    const { unmount } = recover();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(reads).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(reads).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(reads).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(30_000 + 60_000 + 60_000);
    expect(reads).toHaveBeenCalledTimes(5);
    expect(getDailyRecordFreshnessStatus(date)).toBe('blocked_until_remote_check');
    unmount();
  });

  it('does not read while the tab is hidden and resumes when it is visible again', async () => {
    await blockAfterReturningToTheTab();
    reads.mockResolvedValue(confirmedRead());
    visibility = 'hidden';

    const { unmount } = recover();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reads).not.toHaveBeenCalled();

    visibility = 'visible';
    await vi.advanceTimersByTimeAsync(3_000);
    expect(getDailyRecordFreshnessStatus(date)).toBe('fresh_remote_confirmed');
    unmount();
  });

  it('stops trying when the census is closed', async () => {
    await blockAfterReturningToTheTab();
    reads.mockResolvedValue(unavailableRead());

    const { unmount } = recover();
    unmount();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(reads).not.toHaveBeenCalled();
  });
});
