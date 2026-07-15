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

import { collection, doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import {
  asFirestoreUpdatePayload,
  assertFirestoreConcurrency,
  ConcurrencyError,
  createDeletedRecordRef,
  saveHistorySnapshot,
  saveRecordAtomically,
  updateRecordPartiallyAtomically,
} from '@/services/storage/firestore/firestoreWriteSupport';

describe('firestoreWriteSupport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws concurrency error when remote version is newer than expected base', async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ lastUpdated: '2026-02-20T10:00:00.000Z' }),
    } as never);

    await expect(
      assertFirestoreConcurrency(
        {} as never,
        '2026-02-19T10:00:00.000Z',
        'conflict message',
        'save'
      )
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('can enforce strict concurrency without the same-session tolerance window', async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ lastUpdated: '2026-02-20T10:00:01.000Z' }),
    } as never);

    await expect(
      assertFirestoreConcurrency(
        {} as never,
        '2026-02-20T10:00:00.000Z',
        'conflict message',
        'save',
        { toleranceMs: 0 }
      )
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('allows operation when the remote document is missing or older', async () => {
    vi.mocked(getDoc)
      .mockResolvedValueOnce({
        exists: () => false,
      } as never)
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ lastUpdated: Timestamp.now() }),
      } as never);

    await expect(
      assertFirestoreConcurrency(
        {} as never,
        '2026-02-20T10:00:00.000Z',
        'conflict message',
        'save'
      )
    ).resolves.toBeUndefined();

    await expect(
      assertFirestoreConcurrency(
        {} as never,
        '2026-02-20T10:00:00.000Z',
        'conflict message',
        'save'
      )
    ).resolves.toBeUndefined();
  });

  it('allows operation when expected base is missing', async () => {
    await expect(
      assertFirestoreConcurrency({} as never, undefined, 'conflict message', 'save')
    ).resolves.toBeUndefined();
  });

  it('records telemetry when concurrency verification fails for non-conflict reasons', async () => {
    vi.mocked(getDoc).mockRejectedValueOnce(new Error('offline'));

    await expect(
      assertFirestoreConcurrency(
        {} as never,
        '2026-02-20T10:00:00.000Z',
        'conflict message',
        'save'
      )
    ).resolves.toBeUndefined();

    expect(mockCreateOperationalError).not.toHaveBeenCalled();
    expect(mockRecordOperationalErrorTelemetry).toHaveBeenCalledWith(
      'firestore',
      'verify_record_concurrency',
      expect.any(Error),
      expect.objectContaining({
        code: 'firestore_concurrency_verification_failed',
      })
    );
  });

  it('fails closed and rethrows the verification error when failClosed is set', async () => {
    const offline = new Error('offline');
    vi.mocked(getDoc).mockRejectedValueOnce(offline);

    await expect(
      assertFirestoreConcurrency(
        {} as never,
        '2026-02-20T10:00:00.000Z',
        'conflict message',
        'partial update',
        { failClosed: true }
      )
    ).rejects.toBe(offline);

    expect(mockRecordOperationalErrorTelemetry).toHaveBeenCalledWith(
      'firestore',
      'verify_record_concurrency',
      offline,
      expect.objectContaining({
        code: 'firestore_concurrency_verification_failed',
      })
    );
  });

  it('saves a history snapshot when the source record exists', async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ census: 'snapshot' }),
    } as never);

    await saveHistorySnapshot('2026-03-22');

    expect(collection).toHaveBeenCalledWith(
      { kind: 'recordDocRef', date: '2026-03-22' },
      'history'
    );
    expect(doc).toHaveBeenCalled();
    expect(setDoc).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'doc' }),
      expect.objectContaining({
        census: 'snapshot',
        snapshotTimestamp: expect.any(Timestamp),
      })
    );
  });

  it('skips missing history sources and exposes helper payload builders', async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => false,
    } as never);

    await saveHistorySnapshot('2026-03-23');
    expect(setDoc).not.toHaveBeenCalled();

    expect(createDeletedRecordRef('2026-03-23')).toEqual(expect.objectContaining({ kind: 'doc' }));
    expect(asFirestoreUpdatePayload({ status: 'ok' })).toEqual({ status: 'ok' });
  });

  describe('saveRecordAtomically', () => {
    const makeTx = (snap: { exists: () => boolean; data?: () => Record<string, unknown> }) => ({
      get: vi.fn().mockResolvedValue(snap),
      set: vi.fn(),
    });

    it('commits the record when remote is current or missing', async () => {
      const tx = makeTx({ exists: () => false });
      mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
        fn(tx)
      );

      await saveRecordAtomically(
        { kind: 'docRef' } as never,
        { data: 'new' },
        '2026-02-20T10:00:00.000Z',
        'conflict',
        'save'
      );

      expect(tx.set).toHaveBeenCalledWith({ kind: 'docRef' }, { data: 'new' });
    });

    it('writes a history snapshot before committing when the document exists', async () => {
      const tx = makeTx({
        exists: () => true,
        data: () => ({ lastUpdated: '2026-02-20T10:00:00.000Z', beds: {} }),
      });
      mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
        fn(tx)
      );

      await saveRecordAtomically(
        { kind: 'docRef' } as never,
        { data: 'new' },
        '2026-02-20T10:00:00.000Z',
        'conflict',
        'save'
      );

      // Two set calls: history snapshot + the record itself
      expect(tx.set).toHaveBeenCalledTimes(2);
      expect(tx.set).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ kind: 'doc' }),
        expect.objectContaining({
          lastUpdated: '2026-02-20T10:00:00.000Z',
          snapshotTimestamp: expect.any(Object),
        })
      );
      expect(tx.set).toHaveBeenNthCalledWith(2, { kind: 'docRef' }, { data: 'new' });
    });

    it('throws ConcurrencyError when the remote is ahead of expectedLastUpdated', async () => {
      const tx = makeTx({
        exists: () => true,
        data: () => ({ lastUpdated: '2026-02-20T11:00:00.000Z' }),
      });
      mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
        fn(tx)
      );

      await expect(
        saveRecordAtomically(
          { kind: 'docRef' } as never,
          { data: 'stale' },
          '2026-02-20T10:00:00.000Z',
          'conflict message',
          'save'
        )
      ).rejects.toBeInstanceOf(ConcurrencyError);

      expect(tx.set).not.toHaveBeenCalled();
    });

    it('treats even a sub-second-newer remote as a conflict (strict, no tolerance window)', async () => {
      // The atomic save intentionally has NO same-session tolerance: any positive drift is a
      // conflict. This locks that contract so a future tolerance window cannot silently reopen
      // the concurrent-overwrite race.
      const tx = makeTx({
        exists: () => true,
        data: () => ({ lastUpdated: '2026-02-20T10:00:00.500Z' }), // only 500ms newer
      });
      mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
        fn(tx)
      );

      await expect(
        saveRecordAtomically(
          { kind: 'docRef' } as never,
          { data: 'stale' },
          '2026-02-20T10:00:00.000Z',
          'conflict message',
          'save'
        )
      ).rejects.toBeInstanceOf(ConcurrencyError);

      expect(tx.set).not.toHaveBeenCalled();
    });

    it('allows the write when expectedLastUpdated is undefined (new document)', async () => {
      const tx = makeTx({ exists: () => false });
      mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
        fn(tx)
      );

      await saveRecordAtomically(
        { kind: 'docRef' } as never,
        { data: 'first' },
        undefined,
        'conflict',
        'save'
      );

      expect(tx.set).toHaveBeenCalledWith({ kind: 'docRef' }, { data: 'first' });
    });

    it('runs assertSafeOverwrite against remote state and aborts the commit if it throws', async () => {
      const remote = { beds: { H5C2: { patientName: 'Josué' } } };
      const tx = makeTx({ exists: () => true, data: () => remote });
      mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
        fn(tx)
      );
      const guard = vi.fn(() => {
        throw new Error('erasure blocked');
      });

      await expect(
        saveRecordAtomically(
          { kind: 'docRef' } as never,
          { data: 'new' },
          '2026-02-20T10:00:00.000Z', // valid base (CAS passes) so the erasure guard is what fires
          'conflict',
          'save',
          guard
        )
      ).rejects.toThrow('erasure blocked');

      expect(guard).toHaveBeenCalledWith(remote);
      expect(tx.set).not.toHaveBeenCalled();
    });

    it('refuses to overwrite an existing document without a base version', async () => {
      const tx = makeTx({ exists: () => true, data: () => ({ beds: {} }) });
      mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
        fn(tx)
      );
      const guard = vi.fn();

      await expect(
        saveRecordAtomically(
          { kind: 'docRef' } as never,
          { data: 'new' },
          undefined, // no base version + existing doc → unprovable safety → conflict
          'conflict',
          'save',
          guard
        )
      ).rejects.toBeInstanceOf(ConcurrencyError);

      // It fails fast: neither the erasure guard nor the write is reached.
      expect(guard).not.toHaveBeenCalled();
      expect(tx.set).not.toHaveBeenCalled();
    });

    it('commits when assertSafeOverwrite passes', async () => {
      const tx = makeTx({ exists: () => true, data: () => ({ beds: {} }) });
      mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
        fn(tx)
      );
      const guard = vi.fn();

      await saveRecordAtomically(
        { kind: 'docRef' } as never,
        { data: 'new' },
        '2026-02-20T10:00:00.000Z',
        'conflict',
        'save',
        guard
      );

      expect(guard).toHaveBeenCalledTimes(1);
      expect(tx.set).toHaveBeenCalledWith({ kind: 'docRef' }, { data: 'new' });
    });
  });

  describe('updateRecordPartiallyAtomically', () => {
    const makeTx = (snap: { exists: () => boolean; data?: () => Record<string, unknown> }) => ({
      get: vi.fn().mockResolvedValue(snap),
      set: vi.fn(),
      update: vi.fn(),
    });

    it('checks the base and commits the movement patch plus history in one transaction', async () => {
      const tx = makeTx({
        exists: () => true,
        data: () => ({ lastUpdated: '2026-07-14T10:00:00.000Z', discharges: [] }),
      });
      mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
        fn(tx)
      );

      await updateRecordPartiallyAtomically(
        { kind: 'docRef' } as never,
        { discharges: [], cma: [{ id: 'cma-1' }] },
        '2026-07-14T10:00:00.000Z',
        'conflict',
        'movement reclassification'
      );

      expect(tx.set).toHaveBeenCalledTimes(1);
      expect(tx.update).toHaveBeenCalledWith(
        { kind: 'docRef' },
        { discharges: [], cma: [{ id: 'cma-1' }] }
      );
    });

    it('rejects a stale reclassification before writing either movement list', async () => {
      const tx = makeTx({
        exists: () => true,
        data: () => ({ lastUpdated: '2026-07-14T10:00:01.000Z' }),
      });
      mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
        fn(tx)
      );

      await expect(
        updateRecordPartiallyAtomically(
          { kind: 'docRef' } as never,
          { discharges: [], transfers: [{ id: 'transfer-1' }] },
          '2026-07-14T10:00:00.000Z',
          'conflict',
          'movement reclassification'
        )
      ).rejects.toBeInstanceOf(ConcurrencyError);

      expect(tx.set).not.toHaveBeenCalled();
      expect(tx.update).not.toHaveBeenCalled();
    });
  });
});
