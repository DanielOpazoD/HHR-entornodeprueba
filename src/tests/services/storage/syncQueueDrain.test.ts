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
    getRecordDocRef: vi.fn(() => ({ id: 'sync-drain-doc-ref' })),
    sanitizeForFirestore: vi.fn(value => value),
  };
});

import { setDoc } from 'firebase/firestore';

const makeRecord = (date: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2026-03-01T10:00:00.000Z',
  nurses: [],
  activeExtraBeds: [],
});

const dates = ['2026-03-01', '2026-03-02'];
const writtenDate = (record: Parameters<typeof setDoc>[1]): string => {
  if (!('date' in record) || typeof record.date !== 'string') {
    throw new Error('A daily-record Firestore write must include its date');
  }
  return record.date;
};
const writtenDates = () =>
  vi
    .mocked(setDoc)
    .mock.calls.map(([, record]) => writtenDate(record))
    .sort();

describe('sync queue drain contract', () => {
  beforeEach(async () => {
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', 'client_only');
    await hospitalDB.syncQueue.clear();
    vi.clearAllMocks();
    vi.mocked(setDoc).mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    for (const date of dates) await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord(date));
  });

  afterEach(() => vi.unstubAllEnvs());

  it('writes every queued record once and keeps a second drain idempotent', async () => {
    await processSyncQueue();
    expect(await getSyncQueueTelemetry()).toMatchObject({ pending: 0, failed: 0, conflict: 0 });
    expect(writtenDates()).toEqual(dates);
    await processSyncQueue();
    expect(writtenDates()).toEqual(dates);
  });

  it('drains a due retry without replaying the record already acknowledged', async () => {
    vi.mocked(setDoc).mockRejectedValueOnce(new Error('Network temporary failure'));
    await processSyncQueue();
    expect(await getSyncQueueTelemetry()).toMatchObject({ pending: 1, retrying: 1 });
    expect(writtenDates()).toEqual(dates);
    const failedDate = writtenDate(vi.mocked(setDoc).mock.calls[0][1]);
    await hospitalDB.syncQueue
      .where('status')
      .equals('PENDING')
      .modify(task => {
        task.nextAttemptAt = 0;
      });
    await processSyncQueue();
    expect(await getSyncQueueTelemetry()).toMatchObject({ pending: 0, failed: 0, conflict: 0 });
    expect(writtenDates()).toEqual([...dates, failedDate].sort());
  });
});
