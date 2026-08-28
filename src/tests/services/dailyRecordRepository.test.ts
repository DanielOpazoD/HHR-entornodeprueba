/**
 * DailyRecordRepository Tests (Expanded)
 * Updated to support Async/IndexedDB architecture.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getForDate } from '@/services/repositories/dailyRecordRepositoryReadService';
import { initializeDay } from '@/services/repositories/dailyRecordRepositoryInitializationService';
import { save, updatePartial } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { syncWithFirestore } from '@/services/repositories/dailyRecordRepositorySyncService';
import { deleteDailyRecordAcrossStores as deleteDay } from '@/services/repositories/dailyRecordRepositoryFacadeSupport';
import { runExclusiveDailyRecordWrite } from '@/services/repositories/dailyRecordWriteCoordinator';
import { setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { ensureMonthIntegrity } from '@/services/repositories/monthIntegrity';
import {
  saveNurses,
  getNurses,
  saveTens,
  getTens,
} from '@/services/repositories/CatalogRepository';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { clearAllRecords } from '@/services/storage/indexedDBService';

const createDeferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(next => {
    resolve = next;
  });
  return { promise, resolve };
};

vi.unmock('@/services/repositories/dailyRecordRepositoryReadService');
vi.unmock('@/services/repositories/dailyRecordRepositoryWriteService');
vi.unmock('@/services/repositories/dailyRecordRepositoryInitializationService');
vi.unmock('@/services/repositories/dailyRecordRepositorySyncService');
vi.unmock('@/services/repositories/CatalogRepository');

const { firestoreMock } = vi.hoisted(() => ({
  firestoreMock: {
    getRecordFromFirestore: vi.fn().mockResolvedValue(null),
    getRecordFromFirestoreDetailed: vi.fn(),
    saveRecordToFirestore: vi.fn().mockResolvedValue(undefined),
    updateRecordPartial: vi.fn().mockResolvedValue(undefined),
    deleteRecordFromFirestore: vi.fn().mockResolvedValue(undefined),
    subscribeToRecord: vi.fn(() => () => {}),
    moveRecordToTrash: vi.fn().mockResolvedValue(undefined),
    getAvailableDatesFromFirestore: vi.fn().mockResolvedValue([]),
    saveNurseCatalogToFirestore: vi.fn().mockResolvedValue(undefined),
    saveTensCatalogToFirestore: vi.fn().mockResolvedValue(undefined),
    getNurseCatalogFromFirestore: vi.fn().mockResolvedValue([]),
    getTensCatalogFromFirestore: vi.fn().mockResolvedValue([]),
  },
}));

// Mock Firebase SDK
vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
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
    initializeFirestore: vi.fn(),
  };
});

// Mock Firestore Service
vi.mock('@/services/storage/firestore', () => ({
  getRecordFromFirestore: firestoreMock.getRecordFromFirestore,
  getRecordFromFirestoreDetailed: firestoreMock.getRecordFromFirestoreDetailed,
  saveRecordToFirestore: firestoreMock.saveRecordToFirestore,
  updateRecordPartial: firestoreMock.updateRecordPartial,
  deleteRecordFromFirestore: firestoreMock.deleteRecordFromFirestore,
  subscribeToRecord: firestoreMock.subscribeToRecord,
  moveRecordToTrash: firestoreMock.moveRecordToTrash,
  getAvailableDatesFromFirestore: firestoreMock.getAvailableDatesFromFirestore,
  saveNurseCatalogToFirestore: firestoreMock.saveNurseCatalogToFirestore,
  saveTensCatalogToFirestore: firestoreMock.saveTensCatalogToFirestore,
  getNurseCatalogFromFirestore: firestoreMock.getNurseCatalogFromFirestore,
  getTensCatalogFromFirestore: firestoreMock.getTensCatalogFromFirestore,
  getProfessionalsCatalogFromFirestore: vi.fn().mockResolvedValue([]),
  saveProfessionalsCatalogToFirestore: vi.fn(),
  subscribeToNurseCatalog: vi.fn(() => () => {}),
  subscribeToTensCatalog: vi.fn(() => () => {}),
  subscribeToProfessionalsCatalog: vi.fn(() => () => {}),
}));

vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: firestoreMock.getRecordFromFirestore,
  getRecordFromFirestoreDetailed: firestoreMock.getRecordFromFirestoreDetailed,
  getAvailableDatesFromFirestore: firestoreMock.getAvailableDatesFromFirestore,
  subscribeToRecord: firestoreMock.subscribeToRecord,
  getAllRecordsFromFirestore: vi.fn().mockResolvedValue({}),
  getMonthRecordsFromFirestore: vi.fn().mockResolvedValue([]),
  getRecordsRangeFromFirestore: vi.fn().mockResolvedValue([]),
  isFirestoreAvailable: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/services/storage/firestore/firestoreRecordWrites', () => ({
  saveRecordToFirestore: firestoreMock.saveRecordToFirestore,
  updateRecordPartial: firestoreMock.updateRecordPartial,
  deleteRecordFromFirestore: firestoreMock.deleteRecordFromFirestore,
  moveRecordToTrash: firestoreMock.moveRecordToTrash,
  ConcurrencyError: class ConcurrencyError extends Error {},
}));

vi.mock('@/services/storage/firestore/firestoreCatalogService', () => ({
  saveNurseCatalogToFirestore: firestoreMock.saveNurseCatalogToFirestore,
  saveTensCatalogToFirestore: firestoreMock.saveTensCatalogToFirestore,
  getNurseCatalogFromFirestore: firestoreMock.getNurseCatalogFromFirestore,
  getTensCatalogFromFirestore: firestoreMock.getTensCatalogFromFirestore,
  getProfessionalsCatalogFromFirestore: vi.fn().mockResolvedValue([]),
  saveProfessionalsCatalogToFirestore: vi.fn(),
  subscribeToNurseCatalog: vi.fn(() => () => {}),
  subscribeToTensCatalog: vi.fn(() => () => {}),
  subscribeToProfessionalsCatalog: vi.fn(() => () => {}),
}));

// Helper to create mock records
const createMockRecord = (date: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: `${date}T00:00:00.000Z`,
  nurses: ['', ''],
  nursesDayShift: ['', ''],
  nursesNightShift: ['', ''],
  tensDayShift: ['', '', ''],
  tensNightShift: ['', '', ''],
  activeExtraBeds: [],
  schemaVersion: 1,
  dateTimestamp: new Date(date).getTime(),
});

// Helper for valid patients
const createValidPatient = (id: string, overrides: Partial<PatientData> = {}): PatientData =>
  ({
    bedId: id,
    patientName: 'Valid Name',
    rut: '11.111.111-1',
    admissionDate: '2024-12-20',
    bedMode: 'Cama',
    biologicalSex: 'Indeterminado',
    hasWristband: false,
    ...overrides,
  }) as PatientData;

describe('DailyRecordRepository (Expanded)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearAllRecords();

    setFirestoreEnabled(true);
    firestoreMock.getRecordFromFirestoreDetailed.mockImplementation(async (date: string) => {
      try {
        const record = await firestoreMock.getRecordFromFirestore(date);
        return {
          status: record ? 'resolved' : 'missing',
          record,
        };
      } catch (error) {
        return {
          status: 'failed',
          record: null,
          error,
        };
      }
    });
  });

  describe('updatePartial', () => {
    it('updates local and remote data using dot notation', async () => {
      const initial = createMockRecord('2024-12-28');
      initial.beds = { R1: createValidPatient('R1', { patientName: 'Old' }) };
      await save(initial);

      await updatePartial('2024-12-28', { 'beds.R1.patientName': 'New' });

      const updated = await getForDate('2024-12-28');
      expect(updated?.beds.R1.patientName).toBe('New');
      expect(firestoreMock.updateRecordPartial).toHaveBeenCalledWith(
        '2024-12-28',
        expect.objectContaining({ 'beds.R1.patientName': 'New' }),
        expect.any(String),
        expect.objectContaining({
          syncContract: expect.objectContaining({
            changedPaths: ['beds.R1.patientName'],
            expectedVersion: expect.any(String),
          }),
        })
      );
    });

    it('silently catches firestore errors to protect local data', async () => {
      firestoreMock.updateRecordPartial.mockRejectedValueOnce(new Error('Network Fail'));
      const initial = createMockRecord('2024-12-28');
      await save(initial);

      await updatePartial('2024-12-28', { nurses: ['A', 'B'] });

      const updated = await getForDate('2024-12-28');
      expect(updated?.nurses).toEqual(['A', 'B']);
    });
  });

  describe('initializeDay', () => {
    it('leaves day nurses and TENS vacant while inheriting night notes', async () => {
      const prev = createMockRecord('2024-12-27');
      prev.nursesDayShift = ['Nurse Day 1', 'Nurse Day 2'];
      prev.nursesNightShift = ['Nurse Night 1', 'Nurse Night 2'];
      prev.handoffNightReceives = ['Nurse Receive 1', 'Nurse Receive 2'];
      prev.tensNightShift = ['Tens N1', 'Tens N2', 'Tens N3'];
      prev.beds = {
        R1: createValidPatient('R1', {
          patientName: 'Patient 1',
          handoffNoteNightShift: 'Night report',
          handoffNoteDayShift: 'Night report',
        }),
      };

      await save(prev);
      firestoreMock.getRecordFromFirestore.mockResolvedValueOnce(null);

      const initialized = await initializeDay('2024-12-28', '2024-12-27');

      // Inheritance verification
      expect(initialized.nursesDayShift).toEqual(['', '']);
      expect(initialized.tensDayShift).toEqual(['', '', '']);
      expect(initialized.beds['R1'].handoffNoteDayShift).toBe('Night report');
      expect(initialized.beds['R1'].handoffNoteNightShift).toBe('Night report');
      expect(initialized.beds['R1'].patientName).toBe('Patient 1');
    });

    it('clears clinical crib notes during inheritance if they were empty', async () => {
      const prev = createMockRecord('2024-12-27');
      const clinicalCrib = createValidPatient('C1', {
        patientName: 'Baby',
        handoffNoteNightShift: 'Baby report',
      });
      prev.beds = {
        R1: createValidPatient('R1', {
          patientName: 'Mother',
          clinicalCrib: clinicalCrib,
        }),
      };
      await save(prev);

      const initialized = await initializeDay('2024-12-28', '2024-12-27');
      expect(initialized.beds['R1'].clinicalCrib?.handoffNoteDayShift).toBe('Baby report');
    });

    it('prefers firestore record if it exists', async () => {
      const remote = createMockRecord('2024-12-28');
      remote.lastUpdated = '2024-12-28T10:00:00Z';
      firestoreMock.getRecordFromFirestore.mockResolvedValueOnce(remote);

      const initialized = await initializeDay('2024-12-28');

      expect(initialized.lastUpdated).toBe(remote.lastUpdated);
      expect(firestoreMock.getRecordFromFirestoreDetailed).toHaveBeenCalledWith('2024-12-28', {
        source: 'default',
      });
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
  });

  describe('initializeDay edge cases', () => {
    it('initializes empty day correctly when no copyFromDate provided', async () => {
      const initialized = await initializeDay('2024-12-29');
      expect(initialized.date).toBe('2024-12-29');
      expect(Object.keys(initialized.beds).length).toBeGreaterThan(0);
      expect(initialized.nursesDayShift).toEqual(['', '']);
    });

    it('does not migrate legacy nurses into a new day', async () => {
      const prev = createMockRecord('2024-12-27');
      prev.nurses = ['Legacy A', 'Legacy B'];
      // Use empty strings (default state) to test robust fallback
      prev.nursesNightShift = ['', ''];
      prev.nursesDayShift = ['', ''];
      await save(prev);

      const initialized = await initializeDay('2024-12-28', '2024-12-27');
      expect(initialized.nursesDayShift).toEqual(['', '']);
    });

    it('copies patient if they only have diagnosis data', async () => {
      const prev = createMockRecord('2024-12-27');
      prev.beds = {
        R1: createValidPatient('R1', { cie10Code: 'A09' }),
      };
      await save(prev);

      const initialized = await initializeDay('2024-12-28', '2024-12-27');
      expect(initialized.beds['R1'].cie10Code).toBe('A09');
    });

    it('preserves location for extra beds', async () => {
      const prev = createMockRecord('2024-12-27');
      prev.beds = {
        'Extra-1': createValidPatient('Extra-1', { location: 'Hallway' }),
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
        R1: createValidPatient('R1', {
          isBlocked: true,
          bedMode: 'Cama',
          hasCompanionCrib: true,
        }),
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

    it('copies previous day even when a clinical event note is null in legacy data', async () => {
      const prev = createMockRecord('2026-03-03');
      prev.beds = {
        R1: {
          ...createValidPatient('R1', { patientName: 'Paciente Legacy' }),
          clinicalEvents: [
            {
              id: 'event-1',
              name: 'Cirugia',
              date: '2026-03-03',
              note: null,
              createdAt: '2026-03-03T20:33:00.000Z',
            },
          ],
        } as unknown as PatientData,
      };
      await save(prev);

      const initialized = await initializeDay('2026-03-04', '2026-03-03');

      expect(initialized.beds.R1.patientName).toBe('Paciente Legacy');
      expect(initialized.beds.R1.clinicalEvents).toHaveLength(1);
      expect(initialized.beds.R1.clinicalEvents?.[0]?.note).toBeUndefined();
    });
  });

  describe('Maintenance Operations', () => {
    it('deletes records locally and from firestore', async () => {
      const record = createMockRecord('2024-12-28');
      await save(record);
      firestoreMock.getRecordFromFirestore.mockResolvedValue(record);

      await deleteDay('2024-12-28');

      // Check only local storage to verify deletion
      const deleted = await getForDate('2024-12-28', false);
      expect(deleted).toBeNull();
      expect(firestoreMock.moveRecordToTrash).toHaveBeenCalled();
      expect(firestoreMock.deleteRecordFromFirestore).toHaveBeenCalled();
    });

    it('handles deleteDay when record not in firestore', async () => {
      firestoreMock.getRecordFromFirestore.mockResolvedValue(null);
      await deleteDay('2024-12-28');
      expect(firestoreMock.deleteRecordFromFirestore).toHaveBeenCalled();
    });

    it('keeps same-day deletion behind an active structural write window', async () => {
      const date = '2024-12-28';
      await save(createMockRecord(date));
      const structuralStarted = createDeferred();
      const releaseStructural = createDeferred();
      const structural = runExclusiveDailyRecordWrite(date, async () => {
        structuralStarted.resolve();
        await releaseStructural.promise;
      });
      await structuralStarted.promise;

      const deletion = deleteDay(date);
      await Promise.resolve();
      expect(await getForDate(date, false)).not.toBeNull();

      releaseStructural.resolve();
      await Promise.all([structural, deletion]);
      expect(await getForDate(date, false)).toBeNull();
    });

    it('syncs from firestore and saves locally', async () => {
      const remote = createMockRecord('2024-12-28');
      firestoreMock.getRecordFromFirestore.mockResolvedValueOnce(remote);

      const result = await syncWithFirestore('2024-12-28');
      expect(result).toMatchObject(remote);
      expect(firestoreMock.getRecordFromFirestoreDetailed).toHaveBeenCalledWith('2024-12-28', {
        source: 'default',
      });

      const savedLocal = await getForDate('2024-12-28');
      expect(savedLocal?.date).toEqual(remote.date);
    });
  });

  describe('Catalog Operations', () => {
    it('manages nurse catalog locally and syncs to firestore', async () => {
      const nurses = ['Enf A', 'Enf B'];
      await saveNurses(nurses);

      expect(await getNurses()).toEqual(nurses);
      expect(firestoreMock.saveNurseCatalogToFirestore).toHaveBeenCalledWith(nurses);
    });

    it('manages TENS catalog locally and syncs to firestore', async () => {
      const tens = ['Tens 1', 'Tens 2'];
      await saveTens(tens);

      expect(await getTens()).toEqual(tens);
      expect(firestoreMock.saveTensCatalogToFirestore).toHaveBeenCalledWith(tens);
    });
  });
});
