import { describe, expect, it } from 'vitest';
import {
  hasLocalSyncAttention,
  listQuarantinedOperations,
  LOCAL_SYNC_PENDING_VISIBILITY_MS,
} from '@/features/rayen-import/components/localSyncPresentation';
import type { SyncQueueOperation, SyncQueueStats } from '@/hooks/useSyncQueueMonitor';

const makeStats = (overrides: Partial<SyncQueueStats> = {}): SyncQueueStats => ({
  pending: 0,
  failed: 0,
  retrying: 0,
  acked: 0,
  conflict: 0,
  oldestPendingAgeMs: 0,
  ...overrides,
});

describe('localSyncPresentation', () => {
  it('keeps normal saves quiet, including the visibility grace period', () => {
    expect(hasLocalSyncAttention(makeStats())).toBe(false);
    expect(
      hasLocalSyncAttention(
        makeStats({ pending: 1, oldestPendingAgeMs: LOCAL_SYNC_PENDING_VISIBILITY_MS - 1 })
      )
    ).toBe(false);
  });

  it('shows aged pending writes without requiring a failure', () => {
    expect(
      hasLocalSyncAttention(
        makeStats({ pending: 2, oldestPendingAgeMs: LOCAL_SYNC_PENDING_VISIBILITY_MS })
      )
    ).toBe(true);
    expect(hasLocalSyncAttention(makeStats({ pending: 1, oldestPendingAgeMs: 300_000 }))).toBe(
      true
    );
    expect(hasLocalSyncAttention(makeStats({ oldestPendingAgeMs: 300_000 }))).toBe(false);
  });

  it.each([{ failed: 1 }, { conflict: 1 }, { retrying: 1 }, { readState: 'unavailable' as const }])(
    'shows interrupted saves immediately: %j',
    stats => expect(hasLocalSyncAttention(makeStats(stats))).toBe(true)
  );

  it('presenta las operaciones en cuarentena con la taxonomía en castellano', () => {
    const operations: SyncQueueOperation[] = [
      {
        id: 7,
        type: 'UPDATE_DAILY_RECORD',
        status: 'FAILED',
        retryCount: 5,
        timestamp: 1,
        key: 'daily:2026-09-01',
        lastErrorCategory: 'authorization',
        lastErrorAction: 'Revisar permisos/reglas y sesión del usuario.',
      },
      {
        id: 8,
        type: 'UPDATE_DAILY_RECORD',
        status: 'CONFLICT',
        retryCount: 0,
        timestamp: 2,
        key: 'daily:2026-09-02',
        lastErrorCategory: 'conflict',
      },
      // Activas o sin id: fuera de la lista de cuarentena.
      { id: 9, type: 'UPDATE_DAILY_RECORD', status: 'PENDING', retryCount: 0, timestamp: 3 },
      { type: 'UPDATE_DAILY_RECORD', status: 'FAILED', retryCount: 0, timestamp: 4 },
    ];

    expect(listQuarantinedOperations(operations)).toEqual([
      {
        id: 7,
        targetLabel: 'Censo del 01-09-2026',
        categoryLabel: 'Sin permisos',
        recovery: 'retry',
      },
      {
        id: 8,
        targetLabel: 'Censo del 02-09-2026',
        categoryLabel: 'Conflicto de versiones',
        recovery: 'retry',
      },
    ]);
  });
});
