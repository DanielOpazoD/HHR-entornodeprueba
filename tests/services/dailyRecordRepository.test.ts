/**
 * DailyRecordRepository Tests (Expanded)
 * Updated to support Async/IndexedDB architecture.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getForDate,
    save,
    setFirestoreEnabled,
    setDemoModeActive,
    updatePartial,
    initializeDay,
    ensureMonthIntegrity,
    saveNurses,
    getNurses,
    saveTens,
    getTens,
    deleteDay,
    syncWithFirestore
} from '../../services/repositories/DailyRecordRepository';
import { DailyRecord } from '../../types';
import * as firestoreService from '../../services/storage/firestoreService';
import { clearAllRecords } from '../../services/storage/indexedDBService';
vi.unmock('../../services/repositories/DailyRecordRepository');
vi.unmock('@/services/repositories/DailyRecordRepository');

// Mock Firestore Service
vi.mock('../../services/storage/firestoreService', () => ({
    getRecordFromFirestore: vi.fn(),
    saveRecordToFirestore: vi.fn(),
    updateRecordPartial: vi.fn(),
    deleteRecordFromFirestore: vi.fn(),
    subscribeToRecord: vi.fn(),
    saveHistorySnapshot: vi.fn(),
    saveNurseCatalogToFirestore: vi.fn(),
    saveTensCatalogToFirestore: vi.fn()
}));

// Helper to create mock records
const createMockRecord = (date: string): DailyRecord => ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: new Date().toISOString(),
    nurses: ['', ''],
    nursesDayShift: ['', ''],
    nursesNightShift: ['', ''],
    tensDayShift: ['', '', ''],
    tensNightShift: ['', '', ''],
    activeExtraBeds: []
});

describe('DailyRecordRepository (Expanded)', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        await clearAllRecords();

        setFirestoreEnabled(true);
        setDemoModeActive(false);
    });

    describe('updatePartial', () => {
        it('updates local and remote data using dot notation', async () => {
            const initial = createMockRecord('2024-12-28');
            initial.beds = { 'R1': { patientName: 'Old', bedId: 'R1' } as any };
            await save(initial);

            await updatePartial('2024-12-28', { 'beds.R1.patientName': 'New' });

            const updated = await getForDate('2024-12-28');
            expect(updated?.beds.R1.patientName).toBe('New');
            expect(firestoreService.updateRecordPartial).toHaveBeenCalledWith('2024-12-28', { 'beds.R1.patientName': 'New' });
        });

        it('silently catches firestore errors to protect local data', async () => {
            vi.mocked(firestoreService.updateRecordPartial).mockRejectedValueOnce(new Error('Network Fail'));
            const initial = createMockRecord('2024-12-28');
            await save(initial);

            await updatePartial('2024-12-28', { 'nurses': ['A', 'B'] });

            const updated = await getForDate('2024-12-28');
            expect(updated?.nurses).toEqual(['A', 'B']);
        });
    });

    describe('initializeDay', () => {
        it('inherits staff and notes from previous night shift correctly', async () => {
            const prev = createMockRecord('2024-12-27');
            prev.nursesDayShift = ['Nurse Day 1', 'Nurse Day 2'];
            prev.nursesNightShift = ['Nurse Night 1', 'Nurse Night 2'];
            prev.tensNightShift = ['Tens N1', 'Tens N2', 'Tens N3'];
            prev.beds = {
                'R1': {
                    patientName: 'Patient 1',
                    handoffNoteNightShift: 'Night report',
                    handoffNoteDayShift: 'Day report',
                    bedId: 'R1'
                } as any
            };

            await save(prev);
            vi.mocked(firestoreService.getRecordFromFirestore).mockResolvedValueOnce(null);

            const initialized = await initializeDay('2024-12-28', '2024-12-27');

            // Inheritance verification
            expect(initialized.nursesDayShift).toEqual(['Nurse Night 1', 'Nurse Night 2']);
            expect(initialized.tensDayShift).toEqual(['Tens N1', 'Tens N2', 'Tens N3']);
            expect(initialized.beds['R1'].handoffNoteDayShift).toBe('Night report');
            expect(initialized.beds['R1'].handoffNoteNightShift).toBe('Night report');
            expect(initialized.beds['R1'].patientName).toBe('Patient 1');
        });

        it('clears clinical crib notes during inheritance if they were empty', async () => {
            const prev = createMockRecord('2024-12-27');
            prev.beds = {
                'R1': {
                    patientName: 'Mother',
                    clinicalCrib: { patientName: 'Baby', handoffNoteNightShift: 'Baby report' } as any,
                    bedId: 'R1'
                } as any
            };
            await save(prev);

            const initialized = await initializeDay('2024-12-28', '2024-12-27');
            expect(initialized.beds['R1'].clinicalCrib?.handoffNoteDayShift).toBe('Baby report');
        });

        it('prefers firestore record if it exists', async () => {
            const remote = createMockRecord('2024-12-28');
            remote.lastUpdated = '2024-12-28T10:00:00Z';
            vi.mocked(firestoreService.getRecordFromFirestore).mockResolvedValueOnce(remote);

            const initialized = await initializeDay('2024-12-28');

            expect(initialized.lastUpdated).toBe(remote.lastUpdated);
            // Verify local sync
            const savedLocal = await getForDate('2024-12-28');
            expect(savedLocal?.lastUpdated).toBe(remote.lastUpdated);
        });
    });

    describe('ensureMonthIntegrity', () => {
        it('fills missing days and returns detailed result', async () => {
            await clearAllRecords(); // Double check clean slate
            const result = await ensureMonthIntegrity(2025, 1, 3);

            expect(result.success).toBe(true);
            expect(result.initializedDays).toContain('2025-01-01');
            expect(result.totalDays).toBe(3);

            const saved = await getForDate('2025-01-03');
            expect(saved).not.toBeNull();
        });
    });

    describe('getForDate', () => {
        it('returns record from storage when it exists', async () => {
            const record = createMockRecord('2024-12-28');
            await save(record);

            const result = await getForDate('2024-12-28');
            expect(result?.date).toBe('2024-12-28');
        });

        it('uses demo storage in demo mode', async () => {
            setDemoModeActive(true);
            const demoRecord = createMockRecord('demo-date');
            await save(demoRecord);

            const result = await getForDate('demo-date');
            expect(result?.date).toBe('demo-date');
        });
    });

    describe('Catalog Operations', () => {
        it('manages nurse catalog locally and syncs to firestore', async () => {
            const nurses = ['Enf A', 'Enf B'];
            await saveNurses(nurses);

            expect(await getNurses()).toEqual(nurses);
            expect(firestoreService.saveNurseCatalogToFirestore).toHaveBeenCalledWith(nurses);
        });

        it('manages TENS catalog locally and syncs to firestore', async () => {
            const tens = ['Tens 1', 'Tens 2'];
            await saveTens(tens);

            expect(await getTens()).toEqual(tens);
            expect(firestoreService.saveTensCatalogToFirestore).toHaveBeenCalledWith(tens);
        });
    });

    describe('Maintenance Operations', () => {
        it('deletes records locally and from firestore', async () => {
            const record = createMockRecord('2024-12-28');
            await save(record);

            await deleteDay('2024-12-28');

            const deleted = await getForDate('2024-12-28');
            expect(deleted).toBeNull();
            expect(firestoreService.deleteRecordFromFirestore).toHaveBeenCalledWith('2024-12-28');
        });

        it('syncs from firestore and saves locally', async () => {
            const remote = createMockRecord('2024-12-28');
            vi.mocked(firestoreService.getRecordFromFirestore).mockResolvedValueOnce(remote);

            const result = await syncWithFirestore('2024-12-28');
            expect(result).toMatchObject(remote);

            const savedLocal = await getForDate('2024-12-28');
            expect(savedLocal?.date).toEqual(remote.date);
        });
    });
});
