import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  saveRecordToFirestore,
  getRecordFromFirestore,
  updateRecordPartial,
  subscribeToRecord,
  getNurseCatalogFromFirestore,
  saveNurseCatalogToFirestore,
  subscribeToNurseCatalog,
  saveTensCatalogToFirestore,
  getTensCatalogFromFirestore,
  deleteRecordFromFirestore,
  getAllRecordsFromFirestore,
  getMonthRecordsFromFirestore,
  moveRecordToTrash,
  subscribeToTensCatalog,
  isFirestoreAvailable,
  ConcurrencyError,
} from '@/services/storage/firestore';
import * as firestore from 'firebase/firestore';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DocumentSnapshot, QuerySnapshot, Timestamp, DocumentData } from 'firebase/firestore';

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

  return {
    ...actual,
    collection: vi.fn(),
    doc: vi.fn(),
    getDoc: getDocFn,
    setDoc: setDocFn,
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    getDocs: vi.fn(),
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
        }) => Promise<unknown>
      ) => fn({ get: ref => getDocFn(ref), set: (ref, data) => setDocFn(ref, data) })
    ),
  };
});

describe('firestoreService', () => {
  type PartialUpdatePatch = Parameters<typeof updateRecordPartial>[1];
  const flushAsyncSubscription = async () => {
    await Promise.resolve();
  };

  const mockDate = '2024-12-24';
  const mockRecord = {
    date: mockDate,
    beds: {
      BED_01: { patientName: 'John Doe', bedMode: 'Cama' },
    },
    lastUpdated: '2024-12-24T00:00:00.000Z',
    nursesDayShift: ['', ''],
    nursesNightShift: ['', ''],
    tensDayShift: ['', '', ''],
    tensNightShift: ['', '', ''],
  } as unknown as DailyRecord;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should save a record with integrity snapshot', async () => {
    vi.mocked(firestore.setDoc);
    vi.mocked(firestore.getDoc).mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ some: 'old data' }),
      id: 'mock-id',
    } as unknown as DocumentSnapshot<DocumentData>);

    // Pass a base version: saving over an existing doc without one is now a conflict by design.
    await saveRecordToFirestore(mockRecord, '2026-02-19T00:00:00.000Z');

    // Should have called setDoc twice: once for snapshot, once for main record
    expect(firestore.setDoc).toHaveBeenCalledTimes(2);
    expect(firestore.doc).toHaveBeenCalled();
  });

  it('should return null if record does not exist', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    getDocMock.mockResolvedValueOnce({
      exists: () => false,
    } as unknown as DocumentSnapshot);

    const result = await getRecordFromFirestore(mockDate);
    expect(result).toBeNull();
  });

  it('should perform a partial update with snapshot', async () => {
    const updateDocMock = vi.mocked(firestore.updateDoc);
    const getDocMock = vi.mocked(firestore.getDoc);

    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      id: 'mock-id',
      data: () => ({}),
    } as unknown as DocumentSnapshot<DocumentData>);

    await updateRecordPartial(mockDate, {
      'beds.BED_01.patientName': 'Jane Doe',
    } as unknown as PartialUpdatePatch);

    expect(updateDocMock).toHaveBeenCalled();
  });

  it('should reject partial update when remote record is newer than local base', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);

    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      id: 'mock-id',
      data: () => ({
        lastUpdated: Timestamp.now(),
      }),
    } as unknown as DocumentSnapshot<DocumentData>);

    await expect(
      updateRecordPartial(
        mockDate,
        {
          'beds.BED_01.patientName': 'Jane Doe',
        } as unknown as PartialUpdatePatch,
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

    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => corruptedData,
    } as unknown as DocumentSnapshot);

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
        actualOnNext({
          exists: () => true,
          data: () => ({ beds: {} }),
          id: 'mock-id',
          metadata: { hasPendingWrites: false },
        } as unknown as DocumentSnapshot<DocumentData>);
      }
      return vi.fn(); // Return unsubscribe
    });

    const unsub = subscribeToRecord(mockDate, callback);

    expect(callback).toHaveBeenCalled();
    expect(typeof unsub).toBe('function');
  });

  it('should check if firestore is available', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    getDocMock.mockResolvedValueOnce({ exists: () => true } as unknown as DocumentSnapshot);

    const available = await isFirestoreAvailable();
    expect(available).toBe(true);
  });

  it('should fetch nurse catalog from firestore', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ list: ['Nurse 1', 'Nurse 2'] }),
    } as unknown as DocumentSnapshot);

    const list = await getNurseCatalogFromFirestore();
    expect(list).toEqual(['Nurse 1', 'Nurse 2']);
  });

  it('should fetch nurse catalog from legacy nurses field', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ nurses: ['Nurse Legacy'] }),
    } as unknown as DocumentSnapshot);

    const list = await getNurseCatalogFromFirestore();
    expect(list).toEqual(['Nurse Legacy']);
  });

  it('should save nurse catalog to firestore', async () => {
    const setDocMock = vi.mocked(firestore.setDoc);
    await saveNurseCatalogToFirestore(['Nurse A']);
    expect(setDocMock).toHaveBeenCalled();
    const payload = setDocMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toEqual(expect.objectContaining({ list: ['Nurse A'], nurses: ['Nurse A'] }));
  });

  it('should handle catalog subscriptions correctly', async () => {
    const onSnapshotMock = vi.mocked(firestore.onSnapshot);
    const callback = vi.fn();

    onSnapshotMock.mockImplementationOnce((...args: unknown[]) => {
      const onNext = args[1];
      if (typeof onNext === 'function') {
        (onNext as (snapshot: unknown) => void)({
          exists: () => true,
          id: 'mock-id',
          data: () => ({ list: ['Staff 1'] }),
        } as unknown as DocumentSnapshot<DocumentData>);
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
      const onNext = args[1];
      if (typeof onNext === 'function') {
        (onNext as (snapshot: unknown) => void)({
          exists: () => true,
          id: 'mock-id',
          data: () => ({ nurses: ['Legacy Nurse'] }),
        } as unknown as DocumentSnapshot<DocumentData>);
      }
      return vi.fn();
    });

    subscribeToNurseCatalog(callback);
    await flushAsyncSubscription();
    expect(callback).toHaveBeenCalledWith(['Legacy Nurse']);
  });

  it('should save TENS catalog to firestore', async () => {
    const setDocMock = vi.mocked(firestore.setDoc);
    await saveTensCatalogToFirestore(['TENS A']);
    expect(setDocMock).toHaveBeenCalled();
  });

  it('should fetch TENS catalog from firestore', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ list: ['TENS 1'] }),
    } as unknown as DocumentSnapshot);

    const list = await getTensCatalogFromFirestore();
    expect(list).toEqual(['TENS 1']);
  });

  it('should handle catalog fetch errors gracefully', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    getDocMock.mockRejectedValue(new Error('Firestore error'));

    const list = await getNurseCatalogFromFirestore();
    expect(list).toEqual([]);
  });

  it('should return empty array if catalog does not exist', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    getDocMock.mockResolvedValueOnce({ exists: () => false } as unknown as DocumentSnapshot);

    const list = await getNurseCatalogFromFirestore();
    expect(list).toEqual([]);
  });

  it('should delete a record from firestore', async () => {
    const deleteDocMock = vi.mocked(firestore.deleteDoc);
    await deleteRecordFromFirestore(mockDate);
    expect(deleteDocMock).toHaveBeenCalled();
  });

  it('should fetch all records from firestore', async () => {
    const getDocsMock = vi.mocked(firestore.getDocs);
    getDocsMock.mockResolvedValueOnce({
      forEach: (cb: (doc: unknown) => void) =>
        cb({ id: '2024-12-24', data: () => ({ date: '2024-12-24' }) }),
    } as unknown as QuerySnapshot);

    const records = await getAllRecordsFromFirestore();
    expect(records['2024-12-24']).toBeDefined();
  });

  it('should fetch records for a specific month', async () => {
    const getDocsMock = vi.mocked(firestore.getDocs);
    getDocsMock.mockResolvedValueOnce({
      docs: [{ id: '2024-12-01', data: () => ({ date: '2024-12-01' }) }],
    } as unknown as QuerySnapshot);

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

  it('should handle concurrency error on save', async () => {
    const getDocMock = vi.mocked(firestore.getDoc);
    // Mock remote doc with NEWER lastUpdated
    getDocMock.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ lastUpdated: '2025-01-01T00:00:00Z' }),
    } as unknown as DocumentSnapshot);

    await expect(saveRecordToFirestore(mockRecord, '2024-01-01T00:00:00Z')).rejects.toThrow(
      'El registro ha sido modificado por otro usuario'
    );
  });

  it('should subscribe to TENS catalog', async () => {
    const onSnapshotMock = vi.mocked(firestore.onSnapshot);
    const callback = vi.fn();

    onSnapshotMock.mockImplementationOnce((...args: unknown[]) => {
      const onNext = args[1];
      if (typeof onNext === 'function') {
        (onNext as (snapshot: unknown) => void)({
          exists: () => true,
          id: 'mock-id',
          data: () => ({ list: ['TENS A'] }),
        } as unknown as DocumentSnapshot<DocumentData>);
      }
      return vi.fn();
    });

    const unsub = subscribeToTensCatalog(callback);
    await flushAsyncSubscription();

    expect(callback).toHaveBeenCalledWith(['TENS A']);
    expect(typeof unsub).toBe('function');
  });
});
