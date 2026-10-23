import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRunTransaction = vi.fn();

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore');

  class MockTimestamp {
    static now = vi.fn(() => new MockTimestamp());
    toDate() {
      return new Date('2026-02-20T00:00:00.000Z');
    }
  }

  return {
    ...actual,
    collection: vi.fn((...args: unknown[]) => ({ kind: 'collection', args })),
    doc: vi.fn((...args: unknown[]) => ({ kind: 'doc', args })),
    getDoc: vi.fn(),
    runTransaction: (db: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      mockRunTransaction(db, fn),
    setDoc: vi.fn(),
    Timestamp: MockTimestamp,
  };
});

const { mockCreateOperationalError, mockRecordOperationalErrorTelemetry } = vi.hoisted(() => ({
  mockCreateOperationalError: vi.fn((payload: unknown) => payload),
  mockRecordOperationalErrorTelemetry: vi.fn(),
}));

vi.mock('@/constants/firestorePaths', () => ({
  COLLECTIONS: { HOSPITALS: 'hospitals' },
  HOSPITAL_COLLECTIONS: { DELETED_RECORDS: 'deletedRecords' },
  getActiveHospitalId: vi.fn(() => 'hospital-1'),
}));

vi.mock('@/services/firebase-runtime/firestoreRuntime', () => ({
  defaultFirestoreRuntime: { db: { runtime: 'db' } },
}));

vi.mock('@/services/observability/operationalError', () => ({
  createOperationalError: (payload: unknown) => mockCreateOperationalError(payload),
}));

vi.mock('@/services/observability/operationalTelemetryOutcomeRecorder', () => ({
  recordOperationalErrorTelemetry: (
    source: unknown,
    action: unknown,
    error: unknown,
    fallback: unknown
  ) => mockRecordOperationalErrorTelemetry(source, action, error, fallback),
}));

vi.mock('@/services/storage/firestore/firestoreShared', () => ({
  getRecordDocRef: vi.fn((date: string) => ({ kind: 'recordDocRef', date })),
}));

vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { getDb: () => ({ kind: 'db' }) },
}));

import { getDoc, setDoc } from 'firebase/firestore';
import {
  saveHistorySnapshot,
  saveRecordAtomically,
  updateRecordPartiallyAtomically,
} from '@/services/storage/firestore/firestoreWriteSupport';

// The hourly history cadence (historySnapshotCadence): copies before writes, at most one per hour
// per document and device, unless the caller forces one. See ADR_DAILY_RECORD_DOCUMENT_GRANULARITY.
describe('firestoreWriteSupport history cadence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('copies at most once per hour per day unless the caller forces the copy', async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => ({ census: 'snapshot' }),
    } as never);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-03-22T10:00:00.000Z'));
      await saveHistorySnapshot('2026-03-22');
      vi.setSystemTime(new Date('2026-03-22T10:59:00.000Z'));
      await saveHistorySnapshot('2026-03-22');
      expect(setDoc).toHaveBeenCalledTimes(1);
      // Skipping does not even read the day.
      expect(getDoc).toHaveBeenCalledTimes(1);

      await saveHistorySnapshot('2026-03-22', { force: true });
      expect(setDoc).toHaveBeenCalledTimes(2);

      vi.setSystemTime(new Date('2026-03-22T12:00:00.000Z'));
      await saveHistorySnapshot('2026-03-22');
      expect(setDoc).toHaveBeenCalledTimes(3);
    } finally {
      vi.mocked(getDoc).mockReset();
      vi.useRealTimers();
    }
  });

  describe('atomic writes', () => {
    const makeTx = (snap: { exists: () => boolean; data?: () => Record<string, unknown> }) => ({
      get: vi.fn().mockResolvedValue(snap),
      set: vi.fn(),
      update: vi.fn(),
    });

    it('copies the previous state at most once per hour per document', async () => {
      const tx = makeTx({
        exists: () => true,
        data: () => ({ lastUpdated: '2026-02-20T10:00:00.000Z', beds: {} }),
      });
      mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
        fn(tx)
      );
      const day = { kind: 'docRef', path: 'hospitals/h/dailyRecords/2026-02-20' };
      const otherDay = { kind: 'docRef', path: 'hospitals/h/dailyRecords/2026-02-19' };
      const save = (docRef: object) =>
        saveRecordAtomically(
          docRef as never,
          { data: 'new' },
          '2026-02-20T10:00:00.000Z',
          'conflict',
          'save'
        );
      const historyCopies = () =>
        tx.set.mock.calls.filter(([target]) => (target as { kind: string }).kind === 'doc').length;

      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-02-20T10:00:00.000Z'));
        await save(day);
        vi.setSystemTime(new Date('2026-02-20T10:30:00.000Z'));
        await save(day);
        expect(historyCopies()).toBe(1);
        expect(tx.set).toHaveBeenCalledTimes(3);

        await save(otherDay);
        expect(historyCopies()).toBe(2);

        vi.setSystemTime(new Date('2026-02-20T11:00:00.000Z'));
        await save(day);
        expect(historyCopies()).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('always copies when the caller forces it, as restores do', async () => {
      const tx = makeTx({
        exists: () => true,
        data: () => ({ lastUpdated: '2026-02-20T10:00:00.000Z', beds: {} }),
      });
      mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
        fn(tx)
      );
      const day = { kind: 'docRef', path: 'hospitals/h/dailyRecords/2026-02-22' };
      const save = (forceHistorySnapshot: boolean) =>
        saveRecordAtomically(
          day as never,
          { data: 'restored' },
          '2026-02-20T10:00:00.000Z',
          'conflict',
          'restore',
          { forceHistorySnapshot }
        );

      await save(false);
      await save(true);
      await save(false);

      const historyCopies = tx.set.mock.calls.filter(
        ([target]) => (target as { kind: string }).kind === 'doc'
      ).length;
      expect(historyCopies).toBe(2);
    });

    it('does not count a copy whose transaction failed to commit', async () => {
      const tx = makeTx({
        exists: () => true,
        data: () => ({ lastUpdated: '2026-02-20T10:00:00.000Z', beds: {} }),
      });
      const day = { kind: 'docRef', path: 'hospitals/h/dailyRecords/2026-02-21' };
      mockRunTransaction.mockImplementationOnce(
        async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
          await fn(tx);
          throw new Error('synthetic commit failure');
        }
      );
      await expect(
        saveRecordAtomically(day as never, { data: 'new' }, '2026-02-20T10:00:00.000Z', 'c', 's')
      ).rejects.toThrow('synthetic commit failure');

      mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
        fn(tx)
      );
      tx.set.mockClear();
      await saveRecordAtomically(
        day as never,
        { data: 'new' },
        '2026-02-20T10:00:00.000Z',
        'c',
        's'
      );
      expect(tx.set).toHaveBeenCalledTimes(2);
    });

    it('applies the same cadence to multi-field partial updates', async () => {
      const tx = makeTx({
        exists: () => true,
        data: () => ({ lastUpdated: '2026-02-20T10:00:00.000Z', beds: {} }),
      });
      mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
        fn(tx)
      );
      const day = { kind: 'docRef', path: 'hospitals/h/dailyRecords/2026-02-23' };
      const update = () =>
        updateRecordPartiallyAtomically(
          day as never,
          { discharges: [] },
          '2026-02-20T10:00:00.000Z',
          'conflict',
          'movement reclassification'
        );

      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-02-20T10:00:00.000Z'));
        await update();
        vi.setSystemTime(new Date('2026-02-20T10:45:00.000Z'));
        await update();
        expect(tx.set).toHaveBeenCalledTimes(1);
        expect(tx.update).toHaveBeenCalledTimes(2);

        vi.setSystemTime(new Date('2026-02-20T11:00:00.000Z'));
        await update();
        expect(tx.set).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
