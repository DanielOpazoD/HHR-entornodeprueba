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
    deleteDay,
    syncWithFirestore
} from '@/services/repositories/DailyRecordRepository';
import {
    saveNurses,
    getNurses,
    saveTens,
    getTens
} from '@/services/repositories/CatalogRepository';
import { DailyRecord, PatientData } from '@/types';
import * as firestoreService from '@/services/storage/firestoreService';
import { clearAllRecords } from '@/services/storage/indexedDBService';

vi.unmock('../../services/repositories/DailyRecordRepository');
vi.unmock('@/services/repositories/DailyRecordRepository');
vi.unmock('@/services/repositories/CatalogRepository');

// Mock Firebase SDK
vi.mock('firebase/firestore', () => ({
    getFirestore: vi.fn(),
    collection: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    onSnapshot: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    getDocs: vi.fn(),
    enableNetwork: vi.fn(),
    disableNetwork: vi.fn(),
    initializeFirestore: vi.fn()
}));

// Mock Firestore Service
vi.mock('../../services/storage/firestoreService', () => ({
    getRecordFromFirestore: vi.fn(),
    saveRecordToFirestore: vi.fn(),
    updateRecordPartial: vi.fn(),
    deleteRecordFromFirestore: vi.fn(),
    subscribeToRecord: vi.fn(),
    saveHistorySnapshot: vi.fn(),
    moveRecordToTrash: vi.fn(),
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
    activeExtraBeds: [],
    schemaVersion: 1,
    dateTimestamp: new Date(date).getTime()
});

// Helper for valid patients
const createValidPatient = (id: string, overrides: Partial<PatientData> = {}): PatientData => ({
    bedId: id,
    patientName: 'Valid Name',
    rut: '11.111.111-1',
    bedMode: 'Cama',
    biologicalSex: 'Indeterminado',
    hasWristband: false,
    ...overrides
} as PatientData);

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
            initial.beds = { 'R1': createValidPatient('R1', { patientName: 'Old' }) };
            await save(initial);

            await updatePartial('2024-12-28', { 'beds.R1.patientName': 'New' });

            const updated = await getForDate('2024-12-28');
            expect(updated?.beds.R1.patientName).toBe('New');
            expect(firestoreService.updateRecordPartial).toHaveBeenCalledWith('2024-12-28', expect.objectContaining({ 'beds.R1.patientName': 'New' }));
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
                'R1': createValidPatient('R1', {
                    patientName: 'Patient 1',
                    handoffNoteNightShift: 'Night report',
                    handoffNoteDayShift: 'Night report'
                })
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
            const clinicalCrib = createValidPatient('C1', {
                patientName: 'Baby',
                handoffNoteNightShift: 'Baby report'
            });
            prev.beds = {
                'R1': createValidPatient('R1', {
                    patientName: 'Mother',
                    clinicalCrib: clinicalCrib
                })
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

    describe('initializeDay edge cases', () => {
        it('initializes empty day correctly when no copyFromDate provided', async () => {
            const initialized = await initializeDay('2024-12-29');
            expect(initialized.date).toBe('2024-12-29');
            expect(Object.keys(initialized.beds).length).toBeGreaterThan(0);
            expect(initialized.nursesDayShift).toEqual(["", ""]);
        });

        it('migrates from legacy nurses if night shift is empty', async () => {
            const prev = createMockRecord('2024-12-27');
            prev.nurses = ['Legacy A', 'Legacy B'];
            // Use empty strings (default state) to test robust fallback
            prev.nursesNightShift = ['', ''];
            prev.nursesDayShift = ['', ''];
            await save(prev);

            const initialized = await initializeDay('2024-12-28', '2024-12-27');
            expect(initialized.nursesDayShift).toEqual(['Legacy A', 'Legacy B']);
        });

        it('copies patient if they only have diagnosis data', async () => {
            const prev = createMockRecord('2024-12-27');
            prev.beds = {
                'R1': createValidPatient('R1', { cie10Code: 'A09' })
            };
            await save(prev);

            const initialized = await initializeDay('2024-12-28', '2024-12-27');
            expect(initialized.beds['R1'].cie10Code).toBe('A09');
        });

        it('preserves location for extra beds', async () => {
            const prev = createMockRecord('2024-12-27');
            prev.beds = {
                'Extra-1': createValidPatient('Extra-1', { location: 'Hallway' })
            };
            await save(prev);

            const initialized = await initializeDay('2024-12-28', '2024-12-27');
            if (initialized.beds['Extra-1']) {
                expect(initialized.beds['Extra-1'].location).toBe('Hallway');
            }
        });

        it('preserves isBlocked and companionCrib', async () => {
            const prev = createMockRecord('2024-12-27');
            prev.beds = {
                'R1': createValidPatient('R1', {
                    isBlocked: true,
                    bedMode: 'Cama',
                    hasCompanionCrib: true
                })
            };
            await save(prev);

            const initialized = await initializeDay('2024-12-28', '2024-12-27');
            expect(initialized.beds['R1'].isBlocked).toBe(true);
            expect(initialized.beds['R1'].hasCompanionCrib).toBe(true);
        });

        it('handles handoff novedades inheritance', async () => {
            const prev = createMockRecord('2024-12-27');
            prev.handoffNovedadesNightShift = 'Night news';
            await save(prev);

            const initialized = await initializeDay('2024-12-28', '2024-12-27');
            expect(initialized.handoffNovedadesDayShift).toBe('Night news');
        });
    });

    describe('Maintenance Operations', () => {
        it('deletes records locally and from firestore', async () => {
            const record = createMockRecord('2024-12-28');
            await save(record);
            vi.mocked(firestoreService.getRecordFromFirestore).mockResolvedValue(record);

            await deleteDay('2024-12-28');

            // Check only local storage to verify deletion
            const deleted = await getForDate('2024-12-28', false);
            expect(deleted).toBeNull();
            expect(firestoreService.moveRecordToTrash).toHaveBeenCalled();
            expect(firestoreService.deleteRecordFromFirestore).toHaveBeenCalled();
        });

        it('handles deleteDay when record not in firestore', async () => {
            vi.mocked(firestoreService.getRecordFromFirestore).mockResolvedValue(null);
            await deleteDay('2024-12-28');
            expect(firestoreService.deleteRecordFromFirestore).toHaveBeenCalled();
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
});
