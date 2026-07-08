/**
 * Integration Tests for Firebase Synchronization
 *
 * These tests validate the full sync flow:
 * - save → localStorage → Firestore → receive
 * - Catalog sync (nurses, TENS)
 * - Multi-client simulation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { Specialty, PatientStatus } from '@/types/domain/patientClassification';

// Mock Firebase modules
// Create a proper Timestamp mock class for instanceof checks
class MockTimestamp {
  toDate() {
    return new Date('2026-02-20T00:00:00.000Z');
  }
  static now() {
    return new MockTimestamp();
  }
}

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  const setDocFn = vi.fn((_ref?: unknown, _data?: unknown) => Promise.resolve<void>(undefined));
  return {
    ...actual,
    collection: vi.fn(),
    doc: vi.fn(() => ({})),
    getDoc: vi.fn(),
    setDoc: setDocFn,
    deleteDoc: vi.fn(),
    getDocs: vi.fn(),
    query: vi.fn(),
    orderBy: vi.fn(),
    Timestamp: MockTimestamp,
    onSnapshot: vi.fn(),
    where: vi.fn(),
    runTransaction: vi.fn(
      async (
        _db: unknown,
        fn: (tx: {
          get: (ref: unknown) => Promise<unknown>;
          set: (ref: unknown, data: unknown) => void;
        }) => Promise<unknown>
      ) =>
        fn({
          get: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
          set: (ref, data) => setDocFn(ref, data),
        })
    ),
  };
});

vi.mock('@/firebaseConfig', () => ({
  db: {},
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
  lastUpdated: '2026-02-20T00:00:00.000Z',
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
      const { saveRecordToFirestore } = await import('@/services/storage/firestore');

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
      const { saveRecordLocal, getRecordForDate } =
        await import('@/services/storage/unifiedLocalService');

      const record = createMockRecord('2025-12-13');

      // Save to unified local persistence
      await saveRecordLocal(record);

      // Retrieve from unified local persistence
      const retrieved = await getRecordForDate('2025-12-13');

      // Verify all fields are preserved
      expect(retrieved).not.toBeNull();
      expect(retrieved?.date).toBe('2025-12-13');
      expect(retrieved?.nursesDayShift).toEqual(['Nurse A', 'Nurse B']);
      expect(retrieved?.nursesNightShift).toEqual(['Nurse C']);
      expect(retrieved?.tensDayShift).toEqual(['TENS 1', 'TENS 2']);
      expect(retrieved?.tensNightShift).toEqual(['TENS 3']);
    });

    it('should handle empty nurse/TENS arrays', async () => {
      const { saveRecordLocal, getRecordForDate } =
        await import('@/services/storage/unifiedLocalService');

      const record: DailyRecord = {
        ...createMockRecord('2025-12-13'),
        nursesDayShift: [],
        nursesNightShift: undefined,
        tensDayShift: [],
        tensNightShift: undefined,
      };

      await saveRecordLocal(record);
      const retrieved = await getRecordForDate('2025-12-13');

      expect(retrieved?.nursesDayShift).toEqual([]);
      expect(retrieved?.nursesNightShift).toBeUndefined();
    });
  });

  describe('Catalog Sync', () => {
    it('should save and retrieve nurse catalog from localStorage', async () => {
      const { saveStoredNurses, getStoredNurses } =
        await import('@/services/storage/unifiedLocalService');

      const nurses = ['María García', 'Juan Pérez', 'Ana López'];

      await saveStoredNurses(nurses);
      const retrieved = await getStoredNurses();

      expect(retrieved).toEqual(nurses);
    });

    it('should handle empty catalogs', async () => {
      const { saveStoredNurses, getStoredNurses } =
        await import('@/services/storage/unifiedLocalService');

      await saveStoredNurses([]);
      const retrieved = await getStoredNurses();

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
          isUPC: false,
        },
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
