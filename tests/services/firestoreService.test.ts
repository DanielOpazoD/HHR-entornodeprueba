import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    saveRecordToFirestore,
    getRecordFromFirestore,
    updateRecordPartial
} from '../../services/storage/firestoreService';
import * as firestore from 'firebase/firestore';

// Mock the modular Firestore SDK
vi.mock('firebase/firestore', async () => {
    const actual = await vi.importActual('firebase/firestore');

    class MockTimestamp {
        static now = vi.fn(() => new MockTimestamp());
        static fromDate = vi.fn();
        toDate() { return new Date(); }
    }

    return {
        ...actual,
        collection: vi.fn(),
        doc: vi.fn(),
        getDoc: vi.fn(),
        setDoc: vi.fn(),
        updateDoc: vi.fn(),
        deleteDoc: vi.fn(),
        getDocs: vi.fn(),
        query: vi.fn(),
        orderBy: vi.fn(),
        where: vi.fn(),
        onSnapshot: vi.fn(),
        Timestamp: MockTimestamp
    };
});

describe('firestoreService', () => {
    const mockDate = '2024-12-24';
    const mockRecord = {
        date: mockDate,
        beds: {
            'BED_01': { patientName: 'John Doe', bedMode: 'Cama' }
        },
        lastUpdated: new Date().toISOString(),
        nursesDayShift: ['', ''],
        nursesNightShift: ['', ''],
        tensDayShift: ['', '', ''],
        tensNightShift: ['', '', '']
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should save a record with integrity snapshot', async () => {
        const setDocMock = vi.mocked(firestore.setDoc);
        const getDocMock = vi.mocked(firestore.getDoc);

        // Mock getDoc for history snapshot (it checks if doc exists before snapshotting)
        getDocMock.mockResolvedValueOnce({
            exists: () => true,
            data: () => ({ some: 'old data' })
        } as any);

        await saveRecordToFirestore(mockRecord as any);

        // Should have called setDoc twice: once for snapshot, once for main record
        // Wait, saveHistorySnapshot calls setDoc.
        expect(setDocMock).toHaveBeenCalledTimes(2);
        expect(vi.mocked(firestore.doc)).toHaveBeenCalled();
    });

    it('should return null if record does not exist', async () => {
        const getDocMock = vi.mocked(firestore.getDoc);
        getDocMock.mockResolvedValueOnce({
            exists: () => false
        } as any);

        const result = await getRecordFromFirestore(mockDate);
        expect(result).toBeNull();
    });

    it('should perform a partial update with snapshot', async () => {
        const updateDocMock = vi.mocked(firestore.updateDoc);
        const getDocMock = vi.mocked(firestore.getDoc);

        getDocMock.mockResolvedValueOnce({
            exists: () => true,
            data: () => ({})
        } as any);

        await updateRecordPartial(mockDate, { 'beds.BED_01.patientName': 'Jane Doe' } as any);

        expect(updateDocMock).toHaveBeenCalled();
    });

    it('should sanitize corrupted array data from Firestore (object with numeric keys)', async () => {
        const getDocMock = vi.mocked(firestore.getDoc);

        // Mock data where nursesDayShift is stored as an object instead of array (common Firestore corruption when using dot notation incorrectly)
        const corruptedData = {
            beds: {},
            nursesDayShift: { '0': 'Nurse A', '1': 'Nurse B' },
            lastUpdated: firestore.Timestamp.now()
        };

        getDocMock.mockResolvedValueOnce({
            exists: () => true,
            data: () => corruptedData
        } as any);

        const record = await getRecordFromFirestore(mockDate);

        expect(Array.isArray(record?.nursesDayShift)).toBe(true);
        expect(record?.nursesDayShift).toEqual(['Nurse A', 'Nurse B']);
    });

    it('should handle real-time subscriptions correctly', async () => {
        const onSnapshotMock = vi.mocked(firestore.onSnapshot);
        const callback = vi.fn();

        onSnapshotMock.mockImplementationOnce((docRef, options, onNext) => {
            // Trigger the callback manually
            (onNext as any)({
                exists: () => true,
                data: () => ({ beds: {} }),
                metadata: { hasPendingWrites: false }
            });
            return vi.fn(); // Return unsubscribe
        });

        const { subscribeToRecord } = await import('../../services/storage/firestoreService');

        const unsub = subscribeToRecord(mockDate, callback);

        expect(callback).toHaveBeenCalled();
        expect(typeof unsub).toBe('function');
    });

    it('should check if firestore is available', async () => {
        const getDocMock = vi.mocked(firestore.getDoc);
        getDocMock.mockResolvedValueOnce({ exists: () => true } as any);

        const { isFirestoreAvailable } = await import('../../services/storage/firestoreService');
        const available = await isFirestoreAvailable();
        expect(available).toBe(true);
    });

    it('should fetch nurse catalog from firestore', async () => {
        const getDocMock = vi.mocked(firestore.getDoc);
        getDocMock.mockResolvedValueOnce({
            exists: () => true,
            data: () => ({ list: ['Nurse 1', 'Nurse 2'] })
        } as any);

        const { getNurseCatalogFromFirestore } = await import('../../services/storage/firestoreService');
        const list = await getNurseCatalogFromFirestore();
        expect(list).toEqual(['Nurse 1', 'Nurse 2']);
    });

    it('should save nurse catalog to firestore', async () => {
        const setDocMock = vi.mocked(firestore.setDoc);
        const { saveNurseCatalogToFirestore } = await import('../../services/storage/firestoreService');

        await saveNurseCatalogToFirestore(['Nurse A']);
        expect(setDocMock).toHaveBeenCalled();
    });

    it('should handle catalog subscriptions correctly', async () => {
        const onSnapshotMock = vi.mocked(firestore.onSnapshot);
        const callback = vi.fn();

        onSnapshotMock.mockImplementationOnce((docRef, onNext) => {
            (onNext as any)({
                exists: () => true,
                data: () => ({ list: ['Staff 1'] })
            });
            return vi.fn();
        });

        const { subscribeToNurseCatalog } = await import('../../services/storage/firestoreService');
        const unsub = subscribeToNurseCatalog(callback);

        expect(callback).toHaveBeenCalledWith(['Staff 1']);
        expect(typeof unsub).toBe('function');
    });

    it('should save TENS catalog to firestore', async () => {
        const setDocMock = vi.mocked(firestore.setDoc);
        const { saveTensCatalogToFirestore } = await import('../../services/storage/firestoreService');

        await saveTensCatalogToFirestore(['TENS A']);
        expect(setDocMock).toHaveBeenCalled();
    });

    it('should fetch TENS catalog from firestore', async () => {
        const getDocMock = vi.mocked(firestore.getDoc);
        getDocMock.mockResolvedValueOnce({
            exists: () => true,
            data: () => ({ list: ['TENS 1'] })
        } as any);

        const { getTensCatalogFromFirestore } = await import('../../services/storage/firestoreService');
        const list = await getTensCatalogFromFirestore();
        expect(list).toEqual(['TENS 1']);
    });

    it('should handle catalog fetch errors gracefully', async () => {
        const getDocMock = vi.mocked(firestore.getDoc);
        getDocMock.mockRejectedValue(new Error('Firestore error'));

        const { getNurseCatalogFromFirestore } = await import('../../services/storage/firestoreService');
        const list = await getNurseCatalogFromFirestore();
        expect(list).toEqual([]);
    });

    it('should return empty array if catalog does not exist', async () => {
        const getDocMock = vi.mocked(firestore.getDoc);
        getDocMock.mockResolvedValueOnce({ exists: () => false } as any);

        const { getNurseCatalogFromFirestore } = await import('../../services/storage/firestoreService');
        const list = await getNurseCatalogFromFirestore();
        expect(list).toEqual([]);
    });

    it('should delete a record from firestore', async () => {
        const deleteDocMock = vi.mocked(firestore.deleteDoc);
        const { deleteRecordFromFirestore } = await import('../../services/storage/firestoreService');

        await deleteRecordFromFirestore(mockDate);
        expect(deleteDocMock).toHaveBeenCalled();
    });

    it('should fetch all records from firestore', async () => {
        const getDocsMock = vi.mocked(firestore.getDocs);
        getDocsMock.mockResolvedValueOnce({
            forEach: (cb: any) => cb({ id: '2024-12-24', data: () => ({ date: '2024-12-24' }) })
        } as any);

        const { getAllRecordsFromFirestore } = await import('../../services/storage/firestoreService');
        const records = await getAllRecordsFromFirestore();
        expect(records['2024-12-24']).toBeDefined();
    });

    it('should fetch records for a specific month', async () => {
        const getDocsMock = vi.mocked(firestore.getDocs);
        getDocsMock.mockResolvedValueOnce({
            docs: [{ id: '2024-12-01', data: () => ({ date: '2024-12-01' }) }]
        } as any);

        const { getMonthRecordsFromFirestore } = await import('../../services/storage/firestoreService');
        const records = await getMonthRecordsFromFirestore(2024, 11); // December (0-indexed)
        expect(records).toHaveLength(1);
    });

    it('should move record to trash', async () => {
        const setDocMock = vi.mocked(firestore.setDoc);
        const { moveRecordToTrash } = await import('../../services/storage/firestoreService');

        await moveRecordToTrash(mockRecord as any);
        expect(setDocMock).toHaveBeenCalled();

        // The path should contain 'deletedRecords'
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
            data: () => ({ lastUpdated: '2025-01-01T00:00:00Z' })
        } as any);

        const { saveRecordToFirestore } = await import('../../services/storage/firestoreService');

        await expect(saveRecordToFirestore(mockRecord as any, '2024-01-01T00:00:00Z'))
            .rejects.toThrow('El registro ha sido modificado por otro usuario');
    });

    it('should subscribe to TENS catalog', async () => {
        const onSnapshotMock = vi.mocked(firestore.onSnapshot);
        const callback = vi.fn();

        onSnapshotMock.mockImplementationOnce((docRef, onNext) => {
            (onNext as any)({
                exists: () => true,
                data: () => ({ list: ['TENS A'] })
            });
            return vi.fn();
        });

        const { subscribeToTensCatalog } = await import('../../services/storage/firestoreService');
        const unsub = subscribeToTensCatalog(callback);

        expect(callback).toHaveBeenCalledWith(['TENS A']);
        expect(typeof unsub).toBe('function');
    });
});
