// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getRecordFromFirestore,
  updateRecordPartial,
  subscribeToRecord,
  getNurseCatalogFromFirestore,
  saveNurseCatalogToFirestore,
  subscribeToNurseCatalog,
  saveTensCatalogToFirestore,
  getTensCatalogFromFirestore,
  deleteRecordFromFirestore,
  getMonthRecordsFromFirestore,
  moveRecordToTrash,
  subscribeToTensCatalog,
  isFirestoreAvailable,
  ConcurrencyError,
} from '@/services/storage/firestore';
import * as firestore from 'firebase/firestore';
import { DocumentSnapshot, QuerySnapshot, Timestamp, DocumentData } from 'firebase/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createEmptyPatient } from '@/domain/patient/patientFactory';

// Mock the modular Firestore SDK
vi.mock('firebase/firestore', async () => {
  const actual = await vi.importActual('firebase/firestore');

  class MockTimestamp {
    static now = vi.fn(() => new MockTimestamp());
    static fromDate = vi.fn();
    toDate() {
      return new Date('2026-02-20T00:00:00.000Z');
    }
  }

  const getDocFn = vi.fn((_ref?: unknown) => undefined as unknown);
  const setDocFn = vi.fn((_ref?: unknown, _data?: unknown) => undefined);
  const updateDocFn = vi.fn((_ref?: unknown, _data?: unknown) => undefined as unknown);

  return {
    ...actual,
    collection: vi.fn(),
    // Real references always carry a path; the hourly history cadence keys on it.
    doc: vi.fn(() => ({ path: 'hospitals/test/dailyRecords/mock' })),
    getDoc: getDocFn,
    setDoc: setDocFn,
    updateDoc: updateDocFn,
    deleteDoc: vi.fn(),
    getDocs: vi.fn(),
    getDocsFromServer: vi.fn(),
    query: vi.fn(),
    orderBy: vi.fn(),
    where: vi.fn(),
    onSnapshot: vi.fn(),
    Timestamp: MockTimestamp,
    runTransaction: vi.fn(
      async (
        _db: unknown,
        fn: (tx: {
          get: (ref: unknown) => unknown;
          set: (ref: unknown, data: unknown) => void;
          update: (ref: unknown, data: unknown) => void;
        }) => Promise<unknown>
      ) =>
        fn({
          get: ref => getDocFn(ref),
          set: (ref, data) => setDocFn(ref, data),
          update: (ref, data) => void updateDocFn(ref, data),
        })
    ),
  };
});

describe('firestoreService', () => {
  const createDocSnapshot = (
    data?: Record<string, unknown>,
    options: {
      exists?: boolean;
      id?: string;
      metadata?: { hasPendingWrites?: boolean; fromCache?: boolean };
    } = {}
  ): DocumentSnapshot<DocumentData> =>
    ({
      exists: () => options.exists ?? data !== undefined,
      id: options.id ?? 'mock-id',
      data: () => data,
      metadata: {
        hasPendingWrites: false,
        fromCache: false,
        ...options.metadata,
      },
    }) as unknown as DocumentSnapshot<DocumentData>;

  const createQuerySnapshot = (
    docs: Array<{ id: string; data: () => Record<string, unknown> }>
  ): QuerySnapshot<DocumentData> =>
    ({
      docs,
      metadata: { fromCache: false, hasPendingWrites: false },
    }) as unknown as QuerySnapshot<DocumentData>;

  const flushAsyncSubscription = async () => {
    await Promise.resolve();
  };

  const mockDate = '2024-12-24';
  const mockRecord = DataFactory.createMockDailyRecord(mockDate, {
    beds: {
      BED_01: { ...createEmptyPatient('BED_01'), patientName: 'John Doe', bedMode: 'Cama' },
    },
    lastUpdated: '2024-12-24T00:00:00.000Z',
    nursesDayShift: ['', ''],
    nursesNightShift: ['', ''],
    tensDayShift: ['', '', ''],
    tensNightShift: ['', '', ''],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Each test starts without a recent history copy (hourly cadence lives in localStorage).
    localStorage.clear();
  });

  it('should return null if record does not exist', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    getDocMock.mockResolvedValueOnce(createDocSnapshot(undefined, { exists: false }));

    const result = await getRecordFromFirestore(mockDate);
    expect(result).toBeNull();
  });

  it('should perform a partial update with snapshot', async () => {
    const updateDocMock = vi.mocked(firestore.updateDoc);
    const getDocMock = vi.mocked(firestore.getDoc);

    const stored = createDocSnapshot({});
    // The reachability read, the history copy and the write's transaction each read the day.
    getDocMock
      .mockResolvedValueOnce(stored)
      .mockResolvedValueOnce(stored)
      .mockResolvedValueOnce(stored);

    await updateRecordPartial(mockDate, {
      handoffNovedadesDayShift: 'Novedad sintética',
    });

    expect(updateDocMock).toHaveBeenCalled();
  });

  it('should reject partial update when remote record is newer than local base', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);

    const newer = createDocSnapshot({ lastUpdated: Timestamp.now() });
    getDocMock
      .mockResolvedValueOnce(newer)
      .mockResolvedValueOnce(newer)
      .mockResolvedValueOnce(newer);

    await expect(
      updateRecordPartial(
        mockDate,
        {
          handoffNovedadesDayShift: 'Novedad sintética',
        },
        '2026-02-19T00:00:00.000Z'
      )
    ).rejects.toBeInstanceOf(ConcurrencyError);
  });

  it('should sanitize corrupted array data from Firestore (object with numeric keys)', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);

    // Mock data where nursesDayShift is stored as an object instead of array
    const corruptedData = {
      beds: {},
      nursesDayShift: { '0': 'Nurse A', '1': 'Nurse B' },
      lastUpdated: Timestamp.now(),
    };

    getDocMock.mockResolvedValueOnce(createDocSnapshot(corruptedData));

    const record = await getRecordFromFirestore(mockDate);

    expect(Array.isArray(record?.nursesDayShift)).toBe(true);
    expect(record?.nursesDayShift).toEqual(['Nurse A', 'Nurse B']);
  });

  it('should handle real-time subscriptions correctly', async () => {
    const onSnapshotMock = vi.mocked(firestore.onSnapshot);
    const callback = vi.fn();

    onSnapshotMock.mockImplementationOnce((...args: unknown[]) => {
      const maybeOptions = args[1];
      const maybeOnNext = args[2];
      const actualOnNext =
        typeof maybeOptions === 'function'
          ? (maybeOptions as (snapshot: unknown) => void)
          : typeof maybeOnNext === 'function'
            ? (maybeOnNext as (snapshot: unknown) => void)
            : undefined;
      if (typeof actualOnNext === 'function') {
        actualOnNext(createDocSnapshot({ beds: {} }));
      }
      return vi.fn(); // Return unsubscribe
    });

    const unsub = subscribeToRecord(mockDate, callback);

    expect(callback).toHaveBeenCalled();
    expect(typeof unsub).toBe('function');
  });

  it('should check if firestore is available', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    getDocMock.mockResolvedValueOnce(createDocSnapshot({}, { exists: true }));

    const available = await isFirestoreAvailable();
    expect(available).toBe(true);
  });

  it('should fetch nurse catalog from firestore', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    getDocMock.mockResolvedValueOnce(createDocSnapshot({ list: ['Nurse 1', 'Nurse 2'] }));

    const list = await getNurseCatalogFromFirestore();
    expect(list).toEqual(['Nurse 1', 'Nurse 2']);
  });

  it('should fetch nurse catalog from legacy nurses field', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    getDocMock.mockResolvedValueOnce(createDocSnapshot({ nurses: ['Nurse Legacy'] }));

    const list = await getNurseCatalogFromFirestore();
    expect(list).toEqual(['Nurse Legacy']);
  });

  it('should save nurse catalog to firestore', async () => {
    const setDocMock = vi.mocked(firestore.setDoc);
    // The save reads the list and the shared Eloísa people in one transaction; neither exists.
    const absent = createDocSnapshot(undefined, { exists: false });
    vi.mocked(firestore.getDoc).mockResolvedValueOnce(absent).mockResolvedValueOnce(absent);
    await saveNurseCatalogToFirestore(['Nurse A'], []);
    expect(setDocMock).toHaveBeenCalled();
    const payload = setDocMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toEqual(expect.objectContaining({ list: ['Nurse A'], nurses: ['Nurse A'] }));
  });

  it('should handle catalog subscriptions correctly', async () => {
    const onSnapshotMock = vi.mocked(firestore.onSnapshot);
    const callback = vi.fn();

    onSnapshotMock.mockImplementationOnce((...args: unknown[]) => {
      // Catalogs listen with options, so the snapshot handler is the first function argument.
      const onNext = args.find(arg => typeof arg === 'function');
      if (typeof onNext === 'function') {
        (onNext as (snapshot: unknown) => void)(createDocSnapshot({ list: ['Staff 1'] }));
      }
      return vi.fn();
    });

    const unsub = subscribeToNurseCatalog(callback);
    await flushAsyncSubscription();

    expect(callback).toHaveBeenCalledWith(['Staff 1']);
    expect(typeof unsub).toBe('function');
  });

  it('should handle nurse catalog subscriptions with legacy nurses field', async () => {
    const onSnapshotMock = vi.mocked(firestore.onSnapshot);
    const callback = vi.fn();

    onSnapshotMock.mockImplementationOnce((...args: unknown[]) => {
      // Catalogs listen with options, so the snapshot handler is the first function argument.
      const onNext = args.find(arg => typeof arg === 'function');
      if (typeof onNext === 'function') {
        (onNext as (snapshot: unknown) => void)(createDocSnapshot({ nurses: ['Legacy Nurse'] }));
      }
      return vi.fn();
    });

    subscribeToNurseCatalog(callback);
    await flushAsyncSubscription();
    expect(callback).toHaveBeenCalledWith(['Legacy Nurse']);
  });

  it('should save TENS catalog to firestore', async () => {
    const setDocMock = vi.mocked(firestore.setDoc);
    // The save reads the list and the shared Eloísa people in one transaction; neither exists.
    const absent = createDocSnapshot(undefined, { exists: false });
    vi.mocked(firestore.getDoc).mockResolvedValueOnce(absent).mockResolvedValueOnce(absent);
    await saveTensCatalogToFirestore(['TENS A'], []);
    expect(setDocMock).toHaveBeenCalled();
  });

  it('should fetch TENS catalog from firestore', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    getDocMock.mockResolvedValueOnce(createDocSnapshot({ list: ['TENS 1'] }));

    const list = await getTensCatalogFromFirestore();
    expect(list).toEqual(['TENS 1']);
  });

  it('rejects catalog fetch errors so callers can distinguish failure from empty', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    getDocMock.mockRejectedValue(new Error('Firestore error'));

    await expect(getNurseCatalogFromFirestore()).rejects.toThrow('Firestore error');
  });

  it('should return empty array if catalog does not exist', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    getDocMock.mockResolvedValueOnce(createDocSnapshot(undefined, { exists: false }));

    await expect(getNurseCatalogFromFirestore()).resolves.toEqual([]);
  });

  it('should delete a record from firestore', async () => {
    const deleteDocMock = vi.mocked(firestore.deleteDoc);
    await deleteRecordFromFirestore(mockDate);
    expect(deleteDocMock).toHaveBeenCalled();
  });

  it('should fetch records for a specific month', async () => {
    const getDocsMock = vi.mocked(firestore.getDocsFromServer);
    getDocsMock.mockResolvedValueOnce(
      createQuerySnapshot([{ id: '2024-12-01', data: () => ({ date: '2024-12-01' }) }])
    );

    const records = await getMonthRecordsFromFirestore(2024, 11); // December (0-indexed)
    expect(records).toHaveLength(1);
  });

  it('should move record to trash', async () => {
    const setDocMock = vi.mocked(firestore.setDoc);
    await moveRecordToTrash(mockRecord);
    expect(setDocMock).toHaveBeenCalled();

    expect(vi.mocked(firestore.doc)).toHaveBeenCalledWith(
      expect.anything(),
      'hospitals',
      'hanga_roa',
      'deletedRecords',
      expect.stringContaining(`${mockDate}_trash_`)
    );
  });

  it('should subscribe to TENS catalog', async () => {
    const onSnapshotMock = vi.mocked(firestore.onSnapshot);
    const callback = vi.fn();

    onSnapshotMock.mockImplementationOnce((...args: unknown[]) => {
      // Catalogs listen with options, so the snapshot handler is the first function argument.
      const onNext = args.find(arg => typeof arg === 'function');
      if (typeof onNext === 'function') {
        (onNext as (snapshot: unknown) => void)(createDocSnapshot({ list: ['TENS A'] }));
      }
      return vi.fn();
    });

    const unsub = subscribeToTensCatalog(callback);
    await flushAsyncSubscription();

    expect(callback).toHaveBeenCalledWith(['TENS A']);
    expect(typeof unsub).toBe('function');
  });
});
