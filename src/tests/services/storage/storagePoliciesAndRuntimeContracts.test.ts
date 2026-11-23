// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createRepositoryFirestoreRuntime } from '@/services/repositories/repositoryFirestoreRuntime';
import { createFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import {
  buildFirestoreMonthDateRange,
  mapFirestoreRecords,
} from '@/services/storage/firestore/firestoreQuerySupport';
import { HangaRoaDatabase } from '@/services/storage/indexeddb/indexedDbDatabase';
import {
  getIndexedDbRecoveryBudgetSnapshot,
  INDEXED_DB_OPEN_TIMEOUT_MS,
  INDEXED_DB_RECOVERY_RETRY_DELAYS_MS,
  MAX_BACKGROUND_RECOVERY_ATTEMPTS,
} from '@/services/storage/indexeddb/indexedDbRecoveryBudgets';
import { classifySyncError } from '@/services/storage/syncErrorCatalog';
import {
  resolveSyncQueueBudgetState,
  resolveSyncQueueRuntimeState,
  SYNC_QUEUE_RUNTIME_THRESHOLDS,
} from '@/services/storage/sync/syncQueueOperationalBudgets';
import type { FirestoreRuntime } from '@/services/firebase-runtime/firestoreRuntime';
import type { DailyRecord } from '@/types/domain/dailyRecord';

describe('firestoreQuerySupport', () => {
  it('builds month date range for zero-based month indexes', () => {
    expect(buildFirestoreMonthDateRange(2024, 11)).toEqual({
      startDate: '2024-12-01',
      endDate: '2024-12-31',
    });
  });

  it('maps firestore docs from docs array or snapshot-like forEach', () => {
    const mapper = (data: { date: string }, id: string) =>
      ({ date: `${data.date}-${id}` }) as DailyRecord;
    const docs = [
      { id: 'one', data: () => ({ date: '2024-12-01' }) },
      { id: 'two', data: () => ({ date: '2024-12-02' }) },
    ];

    expect(mapFirestoreRecords(docs, mapper)).toEqual([
      { date: '2024-12-01-one' },
      { date: '2024-12-02-two' },
    ]);

    expect(
      mapFirestoreRecords(
        {
          forEach: (callback: (doc: { id: string; data: () => { date: string } }) => void) => {
            docs.forEach(callback);
          },
        },
        mapper
      )
    ).toEqual([{ date: '2024-12-01-one' }, { date: '2024-12-02-two' }]);
  });
});

describe('firestore runtime adapters', () => {
  it('creates a storage/firestore service runtime from an injected firestore runtime', async () => {
    const db = { runtime: 'db' };
    const runtime: FirestoreRuntime = {
      db: db as never,
      ready: Promise.resolve(),
    };

    const serviceRuntime = createFirestoreServiceRuntime(runtime);

    await expect(serviceRuntime.ready).resolves.toBeUndefined();
    expect(serviceRuntime.getDb()).toBe(db);
  });

  it('creates a repository firestore runtime from an injected firestore runtime', () => {
    const db = { runtime: 'repository-db' };

    const repositoryRuntime = createRepositoryFirestoreRuntime({
      db: db as never,
    });

    expect(repositoryRuntime.getDb()).toBe(db);
  });
});

describe('indexedDbDatabase', () => {
  it('keeps the HangaRoaDB schema isolated from runtime recovery logic', () => {
    const database = new HangaRoaDatabase();

    expect(database.name).toBe('HangaRoaDB');
    expect(database.tables.map(table => table.name).sort()).toEqual([
      'auditLogs',
      'catalogs',
      'dailyRecords',
      'errorLogs',
      'settings',
      'syncQueue',
    ]);

    database.close();
  });
});

describe('indexedDbRecoveryBudgets', () => {
  it('exposes the IndexedDB recovery budget snapshot', () => {
    expect(getIndexedDbRecoveryBudgetSnapshot()).toEqual({
      openTimeoutMs: INDEXED_DB_OPEN_TIMEOUT_MS,
      retryDelaysMs: INDEXED_DB_RECOVERY_RETRY_DELAYS_MS,
      maxBackgroundRecoveryAttempts: MAX_BACKGROUND_RECOVERY_ATTEMPTS,
    });
  });
});

describe('syncErrorCatalog', () => {
  it('classifies permission-denied as authorization and non-retryable', () => {
    const result = classifySyncError({
      code: 'permission-denied',
      message: 'Missing or insufficient permissions',
    });

    expect(result.category).toBe('authorization');
    expect(result.retryable).toBe(false);
    expect(result.severity).toBe('high');
  });

  it('classifies network errors as retryable network category', () => {
    const result = classifySyncError(new Error('Network timeout while writing'));

    expect(result.category).toBe('network');
    expect(result.retryable).toBe(true);
  });

  it('classifies concurrency errors as conflict and non-retryable', () => {
    const conflictError = new Error('Concurrency conflict');
    conflictError.name = 'ConcurrencyError';
    const result = classifySyncError(conflictError);

    expect(result.category).toBe('conflict');
    expect(result.retryable).toBe(false);
  });
});

describe('syncQueueOperationalBudgets', () => {
  it('maps values to ok, warning and critical budget states', () => {
    expect(resolveSyncQueueBudgetState(0, 1, 3)).toBe('ok');
    expect(resolveSyncQueueBudgetState(1, 1, 3)).toBe('warning');
    expect(resolveSyncQueueBudgetState(3, 1, 3)).toBe('critical');
  });

  it('escalates runtime state based on oldest pending age and retry counts', () => {
    expect(resolveSyncQueueRuntimeState(0, 0, 0)).toBe('ok');
    expect(
      resolveSyncQueueRuntimeState(0, SYNC_QUEUE_RUNTIME_THRESHOLDS.warningOldestPendingAgeMs, 0)
    ).toBe('degraded');
    expect(
      resolveSyncQueueRuntimeState(0, 0, SYNC_QUEUE_RUNTIME_THRESHOLDS.criticalRetryingSyncTasks)
    ).toBe('blocked');
  });
});
