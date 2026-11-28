import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createIndexedDbBackgroundRecoveryScheduler } from '@/services/storage/indexeddb/indexedDbBackgroundRecoveryScheduler';

const { recordIndexedDbRecoveryNotice } = vi.hoisted(() => ({
  recordIndexedDbRecoveryNotice: vi.fn(),
}));

vi.mock('@/services/storage/indexeddb/indexedDbRecoveryController', () => ({
  recordIndexedDbRecoveryNotice,
}));

describe('indexedDbBackgroundRecoveryScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules one recovery retry at a time and executes the retry callback', () => {
    const onRetry = vi.fn();
    const scheduler = createIndexedDbBackgroundRecoveryScheduler({
      onRetry,
    });

    scheduler.schedule();
    scheduler.schedule();

    expect(recordIndexedDbRecoveryNotice).toHaveBeenCalledTimes(1);
    expect(recordIndexedDbRecoveryNotice).toHaveBeenCalledWith(
      'indexeddb_recovery_retry_scheduled',
      expect.any(String),
      expect.objectContaining({ attempt: 1, scheduledDelayMs: 500 }),
      'retryable'
    );

    vi.advanceTimersByTime(500);

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('cancels a scheduled retry after recovery and grants a fresh budget', () => {
    const onRetry = vi.fn();
    const scheduler = createIndexedDbBackgroundRecoveryScheduler({ onRetry });
    scheduler.schedule();
    scheduler.reset();
    vi.runAllTimers();
    expect(onRetry).not.toHaveBeenCalled();
    scheduler.schedule();
    vi.advanceTimersByTime(500);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
