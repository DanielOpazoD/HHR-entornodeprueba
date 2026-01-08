import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    save as saveRecord,
    getForDate,
    setFirestoreEnabled,
    DailyRecordRepository
} from '../../services/repositories/DailyRecordRepository';
import { DailyRecord } from '../../types';
import * as firestoreService from '../../services/storage/firestoreService';
// We want real implementation for integration test, but mocked firestore
vi.unmock('../../services/repositories/DailyRecordRepository');
vi.unmock('@/services/repositories/DailyRecordRepository');

// Mock Firestore service
vi.mock('../../services/storage/firestoreService', () => ({
    saveRecordToFirestore: vi.fn(),
    subscribeToRecord: vi.fn(() => vi.fn()),
    getRecordFromFirestore: vi.fn(),
    deleteRecordFromFirestore: vi.fn(),
    updateRecordPartial: vi.fn()
}));

describe('Offline Persistence Integration', () => {
    const mockDate = '2024-12-25';
    const mockRecord: DailyRecord = {
        date: mockDate,
        beds: {},
        discharges: [],
        transfers: [],
        cma: [],
        lastUpdated: new Date().toISOString(),
        nurses: [],
        nursesDayShift: [],
        nursesNightShift: [],
        tensDayShift: [],
        tensNightShift: [],
        activeExtraBeds: []
    };

    beforeEach(() => {
        vi.resetAllMocks(); // More thorough than clearAllMocks
        localStorage.clear();
        setFirestoreEnabled(true);
    });

    it('should save to localStorage even if Firestore fails', async () => {
        vi.mocked(firestoreService.saveRecordToFirestore).mockRejectedValueOnce(new Error('Network Failure'));

        try {
            await saveRecord(mockRecord);
        } catch (e) {
            // expected
        }

        const localData = await getForDate(mockDate);
        expect(localData).not.toBeNull();
        expect(localData?.date).toBe(mockDate);
    });

    it('should not call Firestore if disabled', async () => {
        setFirestoreEnabled(false);
        await saveRecord(mockRecord);
        expect(firestoreService.saveRecordToFirestore).not.toHaveBeenCalled();
    });

    it('should initialize day from local storage if firestore fails', async () => {
        // Setup local storage with a previous day
        const prevDate = '2024-12-24';
        const prevRecord = { ...mockRecord, date: prevDate };
        await saveRecord(prevRecord);

        // Mock Firestore failure for GET
        vi.mocked(firestoreService.getRecordFromFirestore).mockRejectedValue(new Error('Timeout'));

        const newRecord = await DailyRecordRepository.initializeDay('2024-12-25', prevDate);

        expect(newRecord.date).toBe('2024-12-25');
        expect(await getForDate('2024-12-25')).not.toBeNull();
    });
});
