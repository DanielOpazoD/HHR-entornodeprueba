// Unmock the repository so we can test the real thing
// (it is mocked globally in tests/setup.ts)
vi.unmock('@/services/repositories/DailyRecordRepository');

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Repository from '@/services/repositories/DailyRecordRepository';
import * as idbService from '@/services/storage/indexedDBService';
import * as firestoreService from '@/services/storage/firestoreService';
import { DailyRecord } from '@/types';

// Mock the dependencies
vi.mock('@/services/storage/indexedDBService', () => ({
    getRecordForDate: vi.fn().mockResolvedValue(null),
    getPreviousDayRecord: vi.fn().mockResolvedValue(null),
    saveRecord: vi.fn(),
    deleteRecord: vi.fn(),
    getAllRecords: vi.fn().mockResolvedValue([]),
    getAllDates: vi.fn().mockResolvedValue([]),
    getAllDemoRecords: vi.fn().mockResolvedValue([]),
    saveDemoRecord: vi.fn(),
    getDemoRecordForDate: vi.fn().mockResolvedValue(null),
    getPreviousDemoDayRecord: vi.fn().mockResolvedValue(null),
    deleteDemoRecord: vi.fn(),
    saveCatalog: vi.fn(),
    getCatalog: vi.fn().mockResolvedValue([]),
    isIndexedDBAvailable: vi.fn().mockReturnValue(true)
}));

vi.mock('@/services/storage/firestoreService', () => ({
    saveRecordToFirestore: vi.fn(),
    subscribeToRecord: vi.fn(() => () => { }),
    deleteRecordFromFirestore: vi.fn(),
    updateRecordPartial: vi.fn(),
    getRecordFromFirestore: vi.fn(),
    saveNurseCatalogToFirestore: vi.fn(),
    saveTensCatalogToFirestore: vi.fn(),
    subscribeToNurseCatalog: vi.fn(() => () => { }),
    subscribeToTensCatalog: vi.fn(() => () => { }),
    moveRecordToTrash: vi.fn().mockResolvedValue(undefined)
}));

describe('DailyRecordRepository', () => {
    const mockDate = '2025-01-01';
    const mockRecord: DailyRecord = {
        date: mockDate,
        beds: {},
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: new Date().toISOString(),
        nurses: [],
        activeExtraBeds: [],
        schemaVersion: 1
    };

    beforeEach(() => {
        vi.resetAllMocks();
        Repository.setDemoModeActive(false);
        Repository.setFirestoreEnabled(true);
    });

    describe('getForDate', () => {
        it('should return from IndexedDB if available', async () => {
            vi.mocked(idbService.getRecordForDate).mockResolvedValue(mockRecord);
            const result = await Repository.getForDate(mockDate);
            expect(result).toEqual(mockRecord);
            expect(idbService.getRecordForDate).toHaveBeenCalledWith(mockDate);
        });

        it('should fallback to Firestore if not in IndexedDB', async () => {
            vi.mocked(idbService.getRecordForDate).mockResolvedValue(null);
            vi.mocked(firestoreService.getRecordFromFirestore).mockResolvedValue(mockRecord);

            const result = await Repository.getForDate(mockDate);
            expect(result).toEqual(mockRecord);
            expect(idbService.saveRecord).toHaveBeenCalled(); // Should cache locally
        });

        it('should use demo storage if demo mode active', async () => {
            Repository.setDemoModeActive(true);
            vi.mocked(idbService.getDemoRecordForDate).mockResolvedValue(mockRecord);

            const result = await Repository.getForDate(mockDate);
            expect(result).toEqual(mockRecord);
            expect(idbService.getDemoRecordForDate).toHaveBeenCalledWith(mockDate);
        });
    });

    describe('save', () => {
        it('should save to both local and remote', async () => {
            vi.mocked(firestoreService.getRecordFromFirestore).mockResolvedValueOnce(null);

            await Repository.save(mockRecord);

            expect(idbService.saveRecord).toHaveBeenCalled();
            expect(firestoreService.saveRecordToFirestore).toHaveBeenCalled();
        });

        it('should block save if regression detected', async () => {
            const remoteWithData: any = {
                ...mockRecord,
                beds: {}
            };
            for (let i = 0; i < 10; i++) {
                remoteWithData.beds[`BED_${i}`] = { patientName: 'Patient ' + i };
            }

            vi.mocked(firestoreService.getRecordFromFirestore).mockResolvedValueOnce(remoteWithData);

            await expect(Repository.save(mockRecord))
                .rejects.toThrow('Se detectó una pérdida masiva de datos');
        });
    });

    describe('initializeDay', () => {
        it('should return existing record if found', async () => {
            vi.mocked(idbService.getRecordForDate).mockResolvedValueOnce(mockRecord);
            const result = await Repository.initializeDay(mockDate);
            expect(result).toEqual(mockRecord);
        });

        it('should create new record and copy from previous day if available', async () => {
            const prevRecord = {
                ...mockRecord,
                date: '2024-12-31',
                nursesNightShift: ['Nurse A', 'Nurse B'],
                beds: { 'R1': { patientName: 'Patient X' } }
            };

            // 1. target date check (local & remote)
            vi.mocked(idbService.getRecordForDate).mockResolvedValueOnce(null);
            vi.mocked(firestoreService.getRecordFromFirestore).mockResolvedValueOnce(null);

            // 2. copy from date check (local)
            vi.mocked(idbService.getRecordForDate).mockResolvedValueOnce(prevRecord as any);

            const result = await Repository.initializeDay(mockDate, '2024-12-31');

            expect(result.date).toBe(mockDate);
            expect(result.nursesDayShift).toEqual(['Nurse A', 'Nurse B']);
            expect(result.beds['R1'].patientName).toBe('Patient X');
        });
    });

    describe('updatePartial', () => {
        it('should update both local and remote', async () => {
            const patch = { 'beds.R1.patientName': 'New Name' };
            await Repository.updatePartial(mockDate, patch as any);

            expect(idbService.getRecordForDate).toHaveBeenCalledWith(mockDate);
            expect(firestoreService.updateRecordPartial).toHaveBeenCalledWith(mockDate, expect.anything());
        });
    });

    describe('syncWithFirestore', () => {
        it('should pull from firestore and save locally', async () => {
            vi.mocked(firestoreService.getRecordFromFirestore).mockResolvedValueOnce(mockRecord);

            const result = await Repository.syncWithFirestore(mockDate);

            expect(result).toEqual(mockRecord);
            expect(idbService.saveRecord).toHaveBeenCalledWith(mockRecord);
        });
    });

    describe('getAvailableDates', () => {
        it('should return combined dates from local and remote', async () => {
            vi.mocked(idbService.getAllDates).mockResolvedValue(['2025-01-01']);
            // Note: getAllDates usually just returns local dates in this repo's implementation
            const dates = await Repository.getAvailableDates();
            expect(dates).toContain('2025-01-01');
        });
    });

    describe('deleteDay', () => {
        it('should delete from local and move to trash in remote', async () => {
            // Mock firestore to have the record so it proceeds to moveRecordToTrash
            vi.mocked(firestoreService.getRecordFromFirestore).mockResolvedValueOnce(mockRecord);

            await Repository.deleteDay(mockDate);
            expect(idbService.deleteRecord).toHaveBeenCalledWith(mockDate);
            expect(firestoreService.moveRecordToTrash).toHaveBeenCalledWith(mockRecord);
        });
    });

    describe('Catalog Operations', () => {
        it('should save nurses to local and remote', async () => {
            await Repository.saveNurses(['N1']);
            expect(idbService.saveCatalog).toHaveBeenCalledWith('nurses', ['N1']);
            expect(firestoreService.saveNurseCatalogToFirestore).toHaveBeenCalledWith(['N1']);
        });

        it('should save TENS to local and remote', async () => {
            await Repository.saveTens(['T1']);
            expect(idbService.saveCatalog).toHaveBeenCalledWith('tens', ['T1']);
            expect(firestoreService.saveTensCatalogToFirestore).toHaveBeenCalledWith(['T1']);
        });

        it('should provide subscribe methods', () => {
            const cb = vi.fn();
            const unsub = Repository.CatalogRepository.subscribeNurses(cb);
            expect(firestoreService.subscribeToNurseCatalog).toHaveBeenCalled();
            expect(typeof unsub).toBe('function');
            unsub();
        });
    });

    describe('getPreviousDay', () => {
        it('should return null if no previous day found', async () => {
            vi.mocked(idbService.getPreviousDayRecord).mockResolvedValue(null);
            const result = await Repository.getPreviousDay(mockDate);
            expect(result).toBeNull();
        });

        it('should return previous day from IDB if it exists', async () => {
            vi.mocked(idbService.getPreviousDayRecord).mockResolvedValue({ date: '2024-12-31' } as any);

            const result = await Repository.getPreviousDay(mockDate);
            expect(result).not.toBeNull();
            expect(result?.date).toBe('2024-12-31');
        });
    });
});
