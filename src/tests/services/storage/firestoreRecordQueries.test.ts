import { beforeEach, describe, expect, it, vi } from 'vitest';

const { firestoreQueryLoggerError } = vi.hoisted(() => ({
  firestoreQueryLoggerError: vi.fn(),
}));

vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore');
  return {
    ...actual,
    doc: vi.fn(() => 'availability-doc-ref'),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    onSnapshot: vi.fn(),
    orderBy: vi.fn((field: string, direction: string) => ({ field, direction })),
    query: vi.fn((...args: unknown[]) => ({ args })),
    where: vi.fn((field: string, op: string, value: string) => ({ field, op, value })),
  };
});

vi.mock('@/firebaseConfig', () => ({
  db: {},
}));

vi.mock('@/constants/firestorePaths', () => ({
  COLLECTIONS: {
    HOSPITALS: 'hospitals',
  },
  getActiveHospitalId: vi.fn(() => 'hanga_roa'),
}));

vi.mock('@/services/storage/firestore/firestoreShared', () => ({
  docToRecord: vi.fn((data: Record<string, unknown>, id: string) => ({
    date: id,
    ...data,
  })),
  getRecordDocRef: vi.fn((date: string) => ({ date })),
  getRecordsCollection: vi.fn(() => 'records-collection'),
}));

vi.mock('@/services/storage/storageLoggers', () => ({
  firestoreQueryLogger: {
    error: firestoreQueryLoggerError,
  },
}));

import { getDoc, getDocs, onSnapshot } from 'firebase/firestore';
import {
  getAllRecordsFromFirestore,
  getAvailableDatesFromFirestore,
  getMonthRecordsFromFirestore,
  getRecordFromFirestore,
  getRecordFromFirestoreDetailed,
  getRecordsRangeFromFirestore,
  isFirestoreAvailable,
  subscribeToRecord,
} from '@/services/storage/firestore/firestoreRecordQueries';

describe('firestoreRecordQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads available dates in descending order and handles failures', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [{ id: '2026-03-10' }, { id: '2026-03-12' }, { id: '2026-03-11' }],
    } as never);

    await expect(getAvailableDatesFromFirestore()).resolves.toEqual([
      '2026-03-12',
      '2026-03-11',
      '2026-03-10',
    ]);

    vi.mocked(getDocs).mockRejectedValueOnce(new Error('offline'));
    await expect(getAvailableDatesFromFirestore()).resolves.toEqual([]);
    expect(firestoreQueryLoggerError).toHaveBeenCalledWith(
      'Firestore query failed: getAvailableDates',
      expect.objectContaining({
        error: expect.any(Error),
      })
    );
  });

  it('gets a single record or null when not found / failing', async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ beds: {}, marker: 'ok' }),
    } as never);
    await expect(getRecordFromFirestore('2026-03-14')).resolves.toEqual({
      date: '2026-03-14',
      beds: {},
      marker: 'ok',
    });

    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => false,
    } as never);
    await expect(getRecordFromFirestore('2026-03-15')).resolves.toBeNull();

    vi.mocked(getDoc).mockRejectedValueOnce(new Error('boom'));
    await expect(getRecordFromFirestore('2026-03-16')).resolves.toBeNull();
    expect(firestoreQueryLoggerError).toHaveBeenCalledWith(
      'Firestore query failed: getRecord',
      expect.objectContaining({
        date: '2026-03-16',
        error: expect.any(Error),
      })
    );
  });

  it('distinguishes missing records from failed record reads', async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => false,
    } as never);
    await expect(getRecordFromFirestoreDetailed('2026-03-17')).resolves.toEqual({
      status: 'missing',
      record: null,
    });

    vi.mocked(getDoc).mockRejectedValueOnce(new Error('denied'));
    await expect(getRecordFromFirestoreDetailed('2026-03-18')).resolves.toMatchObject({
      status: 'failed',
      record: null,
    });
  });

  it('maps all records and date ranges from snapshots', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [
        { id: '2026-03-14', data: () => ({ beds: {} }) },
        { id: '2026-03-13', data: () => ({ beds: { A: true } }) },
      ],
    } as never);

    await expect(getAllRecordsFromFirestore()).resolves.toEqual({
      '2026-03-14': { date: '2026-03-14', beds: {} },
      '2026-03-13': { date: '2026-03-13', beds: { A: true } },
    });

    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [{ id: '2026-03-01', data: () => ({ beds: {}, marker: 'from-range' }) }],
    } as never);

    await expect(getRecordsRangeFromFirestore('2026-03-01', '2026-03-31')).resolves.toEqual([
      { date: '2026-03-01', beds: {}, marker: 'from-range' },
    ]);
  });

  it('delegates month queries to the computed range and handles errors', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [{ id: '2026-02-01', data: () => ({ beds: {} }) }],
    } as never);

    await expect(getMonthRecordsFromFirestore(2026, 1)).resolves.toHaveLength(1);
  });

  it('subscribes to records with metadata and keeps cache untouched on subscription errors', async () => {
    const callback = vi.fn();

    vi.mocked(onSnapshot).mockImplementationOnce((...args: unknown[]) => {
      const onNext = args[2] as (value: unknown) => void;
      onNext({
        exists: () => true,
        data: () => ({ beds: { R1: true } }),
        metadata: { hasPendingWrites: true },
      });
      return vi.fn();
    });

    const unsubscribe = subscribeToRecord('2026-03-14', callback);
    expect(callback).toHaveBeenCalledWith({ date: '2026-03-14', beds: { R1: true } }, true, {
      hasPendingWrites: true,
      fromCache: undefined,
    });
    expect(typeof unsubscribe).toBe('function');

    vi.mocked(onSnapshot).mockImplementationOnce((...args: unknown[]) => {
      const onError = args[3] as (error: unknown) => void;
      onError(new Error('subscription failed'));
      return vi.fn();
    });

    subscribeToRecord('2026-03-15', callback);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(firestoreQueryLoggerError).toHaveBeenCalledWith(
      'Firestore query failed: subscribeToRecord',
      expect.objectContaining({
        date: '2026-03-15',
        error: expect.any(Error),
      })
    );
  });

  it('checks availability via hospital root doc', async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({ exists: () => true } as never);
    await expect(isFirestoreAvailable()).resolves.toBe(true);

    vi.mocked(getDoc).mockRejectedValueOnce(new Error('offline'));
    await expect(isFirestoreAvailable()).resolves.toBe(false);
  });
});
