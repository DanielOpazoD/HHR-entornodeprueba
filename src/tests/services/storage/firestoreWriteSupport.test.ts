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
} from '@/services/storage/firestore/firestoreWriteSupport';

describe('firestoreWriteSupport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The hourly history cadence lives in localStorage; each test starts without prior copies.
    localStorage.clear();
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
});
