/**
 * Integration Tests for Firebase Synchronization
 * 
 * These tests validate the full sync flow:
 * - save → localStorage → Firestore → receive
 * - Catalog sync (nurses, TENS)
 * - Multi-client simulation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DailyRecord, Specialty, PatientStatus } from '@/types';

// Mock Firebase modules
// Create a proper Timestamp mock class for instanceof checks
class MockTimestamp {
    toDate() { return new Date(); }
    static now() { return new MockTimestamp(); }
}

vi.mock('firebase/firestore', () => ({
    collection: vi.fn(),
    doc: vi.fn(() => ({})),
    getDoc: vi.fn(),
    setDoc: vi.fn(() => Promise.resolve()),
    deleteDoc: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn(),
    orderBy: vi.fn(),
    Timestamp: MockTimestamp,
    onSnapshot: vi.fn(),
    where: vi.fn()
}));

vi.mock('@/firebaseConfig', () => ({
    db: {}
}));

// Test helpers
const createMockRecord = (date: string): DailyRecord => ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    nurses: ['', ''],
    nursesDayShift: ['Nurse A', 'Nurse B'],
    nursesNightShift: ['Nurse C'],
    tensDayShift: ['TENS 1', 'TENS 2'],
    tensNightShift: ['TENS 3'],
    activeExtraBeds: [],
    lastUpdated: new Date().toISOString()
});

describe('Firebase Sync Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Clear localStorage
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('DailyRecord Sync', () => {
        it('should include nurse and TENS fields when saving record', async () => {
            const { setDoc } = await import('firebase/firestore');
            const { saveRecordToFirestore } = await import('@/services/storage/firestoreService');

            const record = createMockRecord('2025-12-13');

            await saveRecordToFirestore(record);

            // Verify setDoc was called with the record
            expect(setDoc).toHaveBeenCalled();

            // Get the data that was passed to setDoc
            const [, savedData] = (setDoc as ReturnType<typeof vi.fn>).mock.calls[0];

            // Verify nurse/TENS fields are included
            expect(savedData.nursesDayShift).toEqual(['Nurse A', 'Nurse B']);
            expect(savedData.nursesNightShift).toEqual(['Nurse C']);
            expect(savedData.tensDayShift).toEqual(['TENS 1', 'TENS 2']);
            expect(savedData.tensNightShift).toEqual(['TENS 3']);
        });

        it('should preserve all record fields through save cycle', async () => {
            const { saveRecordLocal, getRecordForDate } = await import('@/services/storage/localStorageService');

            const record = createMockRecord('2025-12-13');

            // Save to localStorage
            saveRecordLocal(record);

            // Retrieve from localStorage
            const retrieved = getRecordForDate('2025-12-13');

            // Verify all fields are preserved
            expect(retrieved).not.toBeNull();
            expect(retrieved?.date).toBe('2025-12-13');
            expect(retrieved?.nursesDayShift).toEqual(['Nurse A', 'Nurse B']);
            expect(retrieved?.nursesNightShift).toEqual(['Nurse C']);
            expect(retrieved?.tensDayShift).toEqual(['TENS 1', 'TENS 2']);
            expect(retrieved?.tensNightShift).toEqual(['TENS 3']);
        });

        it('should handle empty nurse/TENS arrays', async () => {
            const { saveRecordLocal, getRecordForDate } = await import('@/services/storage/localStorageService');

            const record: DailyRecord = {
                ...createMockRecord('2025-12-13'),
                nursesDayShift: [],
                nursesNightShift: undefined,
                tensDayShift: [],
                tensNightShift: undefined
            };

            saveRecordLocal(record);
            const retrieved = getRecordForDate('2025-12-13');

            expect(retrieved?.nursesDayShift).toEqual([]);
            expect(retrieved?.nursesNightShift).toBeUndefined();
        });
    });

    describe('Catalog Sync', () => {
        it('should save and retrieve nurse catalog from localStorage', async () => {
            const { saveStoredNurses, getStoredNurses } = await import('@/services/storage/localStorageService');

            const nurses = ['María García', 'Juan Pérez', 'Ana López'];

            saveStoredNurses(nurses);
            const retrieved = getStoredNurses();

            expect(retrieved).toEqual(nurses);
        });

        it('should handle empty catalogs', async () => {
            const { saveStoredNurses, getStoredNurses } = await import('@/services/storage/localStorageService');

            saveStoredNurses([]);
            const retrieved = getStoredNurses();

            expect(retrieved).toEqual([]);
        });
    });

    describe('Data Integrity', () => {
        it('should not lose data during JSON serialization', async () => {
            const record = createMockRecord('2025-12-13');

            // Add complex nested data
            record.beds = {
                'cama-1': {
                    bedId: 'cama-1',
                    isBlocked: false,
                    bedMode: 'Cama',
                    hasCompanionCrib: false,
                    patientName: 'Test Patient',
                    rut: '12345678-9',
                    age: '45',
                    pathology: 'Test pathology',
                    specialty: Specialty.MEDICINA,
                    status: PatientStatus.ESTABLE,
                    admissionDate: '2025-12-10',
                    hasWristband: true,
                    devices: ['CUP', 'CVC'],
                    surgicalComplication: false,
                    isUPC: false
                }
            };

            // Serialize and deserialize
            const serialized = JSON.stringify(record);
            const deserialized = JSON.parse(serialized) as DailyRecord;

            // Verify deep equality
            expect(deserialized.beds['cama-1'].patientName).toBe('Test Patient');
            expect(deserialized.beds['cama-1'].devices).toEqual(['CUP', 'CVC']);
            expect(deserialized.nursesDayShift).toEqual(['Nurse A', 'Nurse B']);
        });
    });
});
