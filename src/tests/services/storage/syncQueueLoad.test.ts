import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexedDBService';
import { getSyncQueueTelemetry, processSyncQueue, queueSyncTask } from '@/services/storage/sync';
import type { DailyRecord } from '@/types/domain/dailyRecord';

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  const { createSingleAttemptFirestoreMock } =
    await import('./singleAttemptFirestoreTransactionMock');
  return { ...actual, ...createSingleAttemptFirestoreMock() };
});

vi.mock('@/services/storage/firestore/firestoreShared', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/services/storage/firestore/firestoreShared')>();
  return {
    ...actual,
    getRecordDocRef: vi.fn(() => ({ id: 'sync-load-doc-ref' })),
    sanitizeForFirestore: vi.fn(value => value),
  };
});

import { setDoc } from 'firebase/firestore';

const toInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
};

const LOAD_VOLUME = toInt(process.env.SYNC_QUEUE_LOAD_VOLUME, 120);
const RETRY_VOLUME = toInt(process.env.SYNC_QUEUE_RETRY_VOLUME, 40);
const MAX_FLUSH_MS = toInt(process.env.SYNC_QUEUE_LOAD_MAX_MS, 8000);

const makeRecord = (date: string, marker: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: marker,
  nurses: [],
  activeExtraBeds: [],
});

describe('syncQueueService load baseline', () => {
  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  });

  it('flushes the configured queued-record volume within its load budget', async () => {
    const total = LOAD_VOLUME;
    for (let i = 0; i < total; i++) {
      const date = `2026-03-${String((i % 28) + 1).padStart(2, '0')}-${i}`;
      await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord(date, `v${i}`));
    }

    const t0 = performance.now();
    await processSyncQueue();
    const elapsedMs = performance.now() - t0;

    const telemetry = await getSyncQueueTelemetry();
    expect(telemetry.pending).toBe(0);
    expect(telemetry.failed).toBe(0);
    expect(telemetry.conflict).toBe(0);
    expect(telemetry.batchSize).toBeGreaterThan(0);
    expect(vi.mocked(setDoc)).toHaveBeenCalledTimes(total);
    expect(elapsedMs).toBeLessThan(MAX_FLUSH_MS);
  });

  it('supports retry burst and eventual drain after nextAttemptAt is reached', async () => {
    const total = RETRY_VOLUME;
    let callCount = 0;
    vi.mocked(setDoc).mockImplementation(async () => {
      callCount += 1;
      if (callCount <= 10) {
        throw new Error('Network temporary failure');
      }
    });

    for (let i = 0; i < total; i++) {
      const date = `2026-04-${String((i % 28) + 1).padStart(2, '0')}-${i}`;
      await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord(date, `r${i}`));
    }

    await processSyncQueue();
    let telemetry = await getSyncQueueTelemetry();
    expect(telemetry.pending).toBeGreaterThan(0);
    expect(telemetry.retrying).toBeGreaterThan(0);

    await hospitalDB.syncQueue
      .where('status')
      .equals('PENDING')
      .modify(task => {
        task.nextAttemptAt = 0;
      });

    await processSyncQueue();
    telemetry = await getSyncQueueTelemetry();
    expect(telemetry.pending).toBe(0);
    expect(telemetry.failed).toBe(0);
    expect(telemetry.conflict).toBe(0);
  });
});

// These fixtures mock Firestore setDoc, not the callable transport.
// Pin their legacy lane even when release verification inherits enforced mode.
beforeEach(() => vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', 'client_only'));
afterEach(() => vi.unstubAllEnvs());
