import { describe, expect, it } from 'vitest';

import { resolveDailyRecordSyncStatus } from '@/hooks/controllers/dailyRecordSyncStatusController';

describe('resolveDailyRecordSyncStatus', () => {
  it('returns saving when any mutation is pending', () => {
    const status = resolveDailyRecordSyncStatus([
      { isPending: false, isError: false, isSuccess: false },
      { isPending: true, isError: false, isSuccess: false },
    ]);

    expect(status).toBe('saving');
  });

  it('returns error when none pending and at least one errored', () => {
    const status = resolveDailyRecordSyncStatus([
      { isPending: false, isError: true, isSuccess: false },
      { isPending: false, isError: false, isSuccess: true },
    ]);

    expect(status).toBe('error');
  });

  it('returns saved when none pending/errored and at least one succeeded', () => {
    const status = resolveDailyRecordSyncStatus([
      { isPending: false, isError: false, isSuccess: true },
      { isPending: false, isError: false, isSuccess: false },
    ]);

    expect(status).toBe('saved');
  });

  it('returns idle when no mutation has activity', () => {
    const status = resolveDailyRecordSyncStatus([
      { isPending: false, isError: false, isSuccess: false },
      { isPending: false, isError: false, isSuccess: false },
    ]);

    expect(status).toBe('idle');
  });
});
