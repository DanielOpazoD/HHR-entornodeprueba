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
  getRecordDocRef: vi.fn((date: string) => ({
    kind: 'recordDocRef',
    date,
    path: `hospitals/h/dailyRecords/${date}`,
  })),
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

  it('keeps a separate cadence per day', async () => {
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => ({}) } as never);
    await saveHistorySnapshot('2026-03-22');
    await saveHistorySnapshot('2026-03-23');
    await saveHistorySnapshot('2026-03-22');
    expect(setDoc).toHaveBeenCalledTimes(2);
    vi.mocked(getDoc).mockReset();
  });

  it('does not count a copy whose write failed, so the next save copies again', async () => {
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => ({}) } as never);
    vi.mocked(setDoc).mockRejectedValueOnce(new Error('synthetic network failure'));
    await saveHistorySnapshot('2026-03-24');
    await saveHistorySnapshot('2026-03-24');
    expect(setDoc).toHaveBeenCalledTimes(2);
    vi.mocked(getDoc).mockReset();
  });

  it('stops re-reading the day for an hour when the rules deny the copy', async () => {
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => ({}) } as never);
    vi.mocked(setDoc).mockRejectedValueOnce(
      Object.assign(new Error('Missing or insufficient permissions.'), {
        code: 'permission-denied',
      })
    );
    await saveHistorySnapshot('2026-03-25');
    await saveHistorySnapshot('2026-03-25');
    expect(getDoc).toHaveBeenCalledTimes(1);
    vi.mocked(getDoc).mockReset();
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

    const partialTx = () =>
      makeTx({
        exists: () => true,
        data: () => ({ lastUpdated: '2026-02-20T10:00:00.000Z', beds: {} }),
      });
    const updateDay = (path: string, options?: { historyPolicy?: 'snapshot' | 'skip' }) =>
      updateRecordPartiallyAtomically(
        { kind: 'docRef', path } as never,
        { discharges: [] },
        '2026-02-20T10:00:00.000Z',
        'conflict',
        'movement reclassification',
        options
      );

    it('keeps a separate cadence per day for partial updates and honours historyPolicy', async () => {
      const tx = partialTx();
      mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
        fn(tx)
      );
      await updateDay('hospitals/h/dailyRecords/2026-02-24');
      await updateDay('hospitals/h/dailyRecords/2026-02-25');
      await updateDay('hospitals/h/dailyRecords/2026-02-24');
      expect(tx.set).toHaveBeenCalledTimes(2);

      await updateDay('hospitals/h/dailyRecords/2026-02-24', { historyPolicy: 'snapshot' });
      expect(tx.set).toHaveBeenCalledTimes(3);
      await updateDay('hospitals/h/dailyRecords/2026-02-26', { historyPolicy: 'skip' });
      expect(tx.set).toHaveBeenCalledTimes(3);
      await updateDay('hospitals/h/dailyRecords/2026-02-26');
      expect(tx.set).toHaveBeenCalledTimes(4);
    });

    it('does not count a partial update copy whose transaction failed to commit', async () => {
      const tx = partialTx();
      mockRunTransaction.mockImplementationOnce(
        async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
          await fn(tx);
          throw new Error('synthetic commit failure');
        }
      );
      await expect(updateDay('hospitals/h/dailyRecords/2026-02-27')).rejects.toThrow(
        'synthetic commit failure'
      );
      mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
        fn(tx)
      );
      await updateDay('hospitals/h/dailyRecords/2026-02-27');
      expect(tx.set).toHaveBeenCalledTimes(2);
    });

    it('marks only what the attempt that committed wrote when Firestore retries', async () => {
      const day = { kind: 'docRef', path: 'hospitals/h/dailyRecords/2026-02-28' };
      const existing = makeTx({
        exists: () => true,
        data: () => ({ lastUpdated: '2026-02-20T10:00:00.000Z', beds: {} }),
      });
      const gone = makeTx({ exists: () => false });
      // First attempt copies, then the retry finds no document and commits without a copy.
      mockRunTransaction.mockImplementationOnce(
        async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
          await fn(existing);
          await fn(gone);
        }
      );
      await saveRecordAtomically(
        day as never,
        { data: 'new' },
        '2026-02-20T10:00:00.000Z',
        'c',
        's'
      );

      mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
        fn(existing)
      );
      existing.set.mockClear();
      await saveRecordAtomically(
        day as never,
        { data: 'new' },
        '2026-02-20T10:00:00.000Z',
        'c',
        's'
      );
      expect(existing.set).toHaveBeenCalledTimes(2);
    });
  });
});
