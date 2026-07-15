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
    runTransaction: (db: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      mockRunTransaction(db, fn),
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

import {
  ConcurrencyError,
  updateRecordPartiallyAtomically,
} from '@/services/storage/firestore/firestoreWriteSupport';

describe('updateRecordPartiallyAtomically', () => {
  const makeTx = (snap: { exists: () => boolean; data?: () => Record<string, unknown> }) => ({
    get: vi.fn().mockResolvedValue(snap),
    set: vi.fn(),
    update: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('rejects a missing remote record instead of recreating it from an incomplete patch', async () => {
    const tx = makeTx({ exists: () => false });
    mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
      fn(tx)
    );

    await expect(
      updateRecordPartiallyAtomically(
        { kind: 'docRef' } as never,
        { discharges: [], cma: [{ id: 'cma-1' }] },
        '2026-07-14T10:00:00.000Z',
        'conflict',
        'movement reclassification'
      )
    ).rejects.toBeInstanceOf(ConcurrencyError);

    expect(tx.set).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(mockCreateOperationalError).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ reason: 'missing_remote_record' }),
      })
    );
    expect(mockRecordOperationalErrorTelemetry).toHaveBeenCalledWith(
      'firestore',
      'atomic_partial_update_concurrency',
      expect.anything(),
      expect.objectContaining({ code: 'firestore_concurrency_conflict' })
    );
  });

  it('rejects an existing record without an expected base version and records telemetry', async () => {
    const tx = makeTx({
      exists: () => true,
      data: () => ({ lastUpdated: '2026-07-14T10:00:00.000Z' }),
    });
    mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
      fn(tx)
    );

    await expect(
      updateRecordPartiallyAtomically(
        { kind: 'docRef' } as never,
        { discharges: [], cma: [{ id: 'cma-1' }] },
        undefined,
        'conflict',
        'movement reclassification'
      )
    ).rejects.toBeInstanceOf(ConcurrencyError);

    expect(tx.set).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(mockCreateOperationalError).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ reason: 'missing_base_version' }),
      })
    );
    expect(mockRecordOperationalErrorTelemetry).toHaveBeenCalledWith(
      'firestore',
      'atomic_partial_update_concurrency',
      expect.anything(),
      expect.objectContaining({ code: 'firestore_concurrency_conflict' })
    );
  });

  it.each([
    ['older', '2026-07-14T09:59:59.000Z'],
    ['missing', undefined],
    ['invalid', 'not-a-date'],
  ])('rejects a %s remote base version', async (_label, remoteLastUpdated) => {
    const tx = makeTx({
      exists: () => true,
      data: () => ({ lastUpdated: remoteLastUpdated }),
    });
    mockRunTransaction.mockImplementation((_db: unknown, fn: (tx: unknown) => Promise<void>) =>
      fn(tx)
    );

    await expect(
      updateRecordPartiallyAtomically(
        { kind: 'docRef' } as never,
        { transfers: [], cma: [{ id: 'cma-1' }] },
        '2026-07-14T10:00:00.000Z',
        'conflict',
        'movement reclassification'
      )
    ).rejects.toBeInstanceOf(ConcurrencyError);

    expect(tx.set).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });
});
