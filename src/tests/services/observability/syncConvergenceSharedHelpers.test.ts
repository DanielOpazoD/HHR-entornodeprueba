import { describe, expect, it } from 'vitest';
import { hasPendingOutboxForPath } from '@/services/observability/syncConvergenceSharedHelpers';
import type { SyncQueueOperationSnapshot } from '@/services/storage/sync';

const makeOutboxOperation = (changedPaths: string[]): SyncQueueOperationSnapshot => ({
  id: 1,
  type: 'UPDATE_DAILY_RECORD',
  status: 'PENDING',
  retryCount: 0,
  timestamp: Date.parse('2026-07-02T09:00:00.000Z'),
  key: 'daily:2026-07-02',
  contexts: ['clinical'],
  syncContract: {
    mutationId: 'mutation-1',
    changedPaths,
  },
});

describe('syncConvergenceSharedHelpers', () => {
  it('matches pending outbox paths by exact path, descendants, ancestors and wildcard', () => {
    expect(
      hasPendingOutboxForPath(
        [makeOutboxOperation(['beds.R2.medicalHandoffEntries.mh-1'])],
        'beds.R2.medicalHandoffEntries.mh-1'
      )
    ).toBe(true);

    expect(
      hasPendingOutboxForPath(
        [makeOutboxOperation(['beds.R2.medicalHandoffEntries.mh-1.note'])],
        'beds.R2.medicalHandoffEntries.mh-1'
      )
    ).toBe(true);

    expect(
      hasPendingOutboxForPath(
        [makeOutboxOperation(['beds.R2'])],
        'beds.R2.medicalHandoffEntries.mh-1'
      )
    ).toBe(true);

    expect(hasPendingOutboxForPath([makeOutboxOperation(['*'])], 'discharges.D1')).toBe(true);

    expect(
      hasPendingOutboxForPath(
        [makeOutboxOperation(['beds.R3'])],
        'beds.R2.medicalHandoffEntries.mh-1'
      )
    ).toBe(false);
  });
});
