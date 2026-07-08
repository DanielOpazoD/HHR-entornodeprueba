vi.unmock('@/services/repositories/dailyRecordRepositoryReadService');
vi.unmock('@/services/repositories/dailyRecordRepositoryWriteService');
vi.unmock('@/services/repositories/dailyRecordRepositoryInitializationService');
vi.unmock('@/services/repositories/dailyRecordRepositorySyncService');
vi.unmock('@/services/repositories/CatalogRepository');

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogRepository } from '@/services/repositories/CatalogRepository';
import {
  bridgeLegacyRecordForDate,
  getAvailableDates,
  getForDate,
  getForDateWithMeta,
  getPreviousDay,
  getPreviousDayWithMeta,
} from '@/services/repositories/dailyRecordRepositoryReadService';
import { deleteDailyRecordAcrossStores as deleteDay } from '@/services/repositories/dailyRecordRepositoryFacadeSupport';
import { isFirestoreEnabled, setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { save, updatePartial } from '@/services/repositories/dailyRecordRepositoryWriteService';
import {
  copyPatientToDate,
  copyPatientToDateDetailed,
  initializeDay,
  initializeDayDetailed,
} from '@/services/repositories/dailyRecordRepositoryInitializationService';
import { syncWithFirestore } from '@/services/repositories/dailyRecordRepositorySyncService';
import * as idbService from '@/services/storage/indexedDBService';
import * as firestoreService from '@/services/storage/firestore';
import * as legacyRecordBridge from '@/services/storage/migration/legacyRecordReadBridge';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

const { legacyFirebaseMock, indexedDbFacadeMock, firestoreMock } = vi.hoisted(() => ({
  legacyFirebaseMock: {
    getLegacyRecord: vi.fn().mockResolvedValue(null),
    getLegacyNurseCatalog: vi.fn().mockResolvedValue([]),
    getLegacyTensCatalog: vi.fn().mockResolvedValue([]),
    getLegacyRecordsRange: vi.fn().mockResolvedValue([]),
  },
  indexedDbFacadeMock: {
    getRecordForDate: vi.fn().mockResolvedValue(null),
    getPreviousDayRecord: vi.fn().mockResolvedValue(null),
    saveRecord: vi.fn(),
    saveRecordStrict: vi.fn(),
    deleteRecord: vi.fn(),
    getAllRecords: vi.fn().mockResolvedValue([]),
    getAllDates: vi.fn().mockResolvedValue([]),
    getRecordsRange: vi.fn().mockResolvedValue([]),
    getRecordsForMonth: vi.fn().mockResolvedValue([]),
    saveRecords: vi.fn(),
    saveCatalog: vi.fn(),
    getCatalog: vi.fn().mockResolvedValue([]),
    getCatalogValues: vi.fn().mockResolvedValue([]),
    saveCatalogValues: vi.fn(),
    isIndexedDBAvailable: vi.fn().mockReturnValue(true),
  },
  firestoreMock: {
    saveRecordToFirestore: vi.fn(),
    subscribeToRecord: vi.fn(() => () => {}),
    deleteRecordFromFirestore: vi.fn(),
    updateRecordPartial: vi.fn(),
    getRecordFromFirestore: vi.fn(),
    getRecordFromFirestoreDetailed: vi.fn(),
    getAvailableDatesFromFirestore: vi.fn().mockResolvedValue([]),
    saveNurseCatalogToFirestore: vi.fn(),
    saveTensCatalogToFirestore: vi.fn(),
    getNurseCatalogFromFirestore: vi.fn().mockResolvedValue([]),
    getTensCatalogFromFirestore: vi.fn().mockResolvedValue([]),
    getProfessionalsCatalogFromFirestore: vi.fn().mockResolvedValue([]),
    saveProfessionalsCatalogToFirestore: vi.fn(),
    subscribeToNurseCatalog: vi.fn(() => () => {}),
    subscribeToTensCatalog: vi.fn(() => () => {}),
    subscribeToProfessionalsCatalog: vi.fn(() => () => {}),
    moveRecordToTrash: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/storage/migration/legacyRecordReadBridge', () => ({
  getLegacyRecord: legacyFirebaseMock.getLegacyRecord,
  getLegacyRecordsRange: legacyFirebaseMock.getLegacyRecordsRange,
}));
vi.mock('@/services/storage/migration/legacyCatalogReadBridge', () => ({
  getLegacyNurseCatalog: legacyFirebaseMock.getLegacyNurseCatalog,
  getLegacyTensCatalog: legacyFirebaseMock.getLegacyTensCatalog,
}));
vi.mock('@/services/storage/indexedDBService', () => indexedDbFacadeMock);
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDate: indexedDbFacadeMock.getRecordForDate,
  getPreviousDayRecord: indexedDbFacadeMock.getPreviousDayRecord,
  saveRecord: indexedDbFacadeMock.saveRecord,
  saveRecordStrict: indexedDbFacadeMock.saveRecordStrict,
  deleteRecord: indexedDbFacadeMock.deleteRecord,
  getAllRecords: indexedDbFacadeMock.getAllRecords,
  getAllDates: indexedDbFacadeMock.getAllDates,
  getRecordsRange: indexedDbFacadeMock.getRecordsRange,
  getRecordsForMonth: indexedDbFacadeMock.getRecordsForMonth,
  saveRecords: indexedDbFacadeMock.saveRecords,
}));
vi.mock('@/services/storage/indexeddb/indexedDbCatalogService', () => ({
  saveCatalog: indexedDbFacadeMock.saveCatalog,
  getCatalog: indexedDbFacadeMock.getCatalog,
  getCatalogValues: indexedDbFacadeMock.getCatalogValues,
  saveCatalogValues: indexedDbFacadeMock.saveCatalogValues,
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: firestoreMock.getRecordFromFirestore,
  getRecordFromFirestoreDetailed: firestoreMock.getRecordFromFirestoreDetailed,
  getAvailableDatesFromFirestore: firestoreMock.getAvailableDatesFromFirestore,
  subscribeToRecord: firestoreMock.subscribeToRecord,
}));
vi.mock('@/services/storage/firestore/firestoreRecordWrites', () => ({
  saveRecordToFirestore: firestoreMock.saveRecordToFirestore,
  updateRecordPartial: firestoreMock.updateRecordPartial,
  deleteRecordFromFirestore: firestoreMock.deleteRecordFromFirestore,
  moveRecordToTrash: firestoreMock.moveRecordToTrash,
}));
vi.mock('@/services/storage/firestore', () => firestoreMock);

const Repository = {
  bridgeLegacyRecord: bridgeLegacyRecordForDate,
  copyPatientToDate,
  copyPatientToDateDetailed,
  deleteDay,
  getAvailableDates,
  getForDate,
  getForDateWithMeta,
  getPreviousDay,
  getPreviousDayWithMeta,
  initializeDay,
  initializeDayDetailed,
  isFirestoreEnabled,
  save,
  setFirestoreEnabled,
  syncWithFirestore,
  updatePartial,
};

describe('DailyRecordRepository reads', () => {
  const mockDate = '2025-01-01';
  const buildPatient = (overrides: Partial<PatientData> = {}): PatientData => ({
    bedId: 'R1',
    isBlocked: false,
    bedMode: 'Cama',
    hasCompanionCrib: false,
    patientName: '',
    rut: '',
    age: '',
    pathology: '',
    specialty: Specialty.MEDICINA,
    status: PatientStatus.ESTABLE,
    admissionDate: '',
    hasWristband: false,
    devices: [],
    surgicalComplication: false,
    isUPC: false,
    ...overrides,
  });

  const mockRecord: DailyRecord = {
    date: mockDate,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${mockDate}T00:00:00.000Z`,
    nurses: ['', ''],
    nursesDayShift: ['', ''],
    nursesNightShift: ['', ''],
    tensDayShift: ['', '', ''],
    tensNightShift: ['', '', ''],
    activeExtraBeds: [],
    handoffDayChecklist: {},
    handoffNightChecklist: {},
    handoffNightReceives: [],
    handoffNovedadesDayShift: '',
    handoffNovedadesNightShift: '',
    medicalHandoffNovedades: '',
    schemaVersion: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(idbService.getRecordForDate).mockReset();
    vi.mocked(idbService.getPreviousDayRecord).mockReset();
    vi.mocked(idbService.saveRecord).mockReset();
    vi.mocked(indexedDbFacadeMock.saveRecordStrict).mockReset();
    vi.mocked(firestoreService.getRecordFromFirestore).mockReset();

    Repository.setFirestoreEnabled(true);
    vi.mocked(idbService.getRecordForDate).mockResolvedValue(null);
    vi.mocked(indexedDbFacadeMock.saveRecordStrict).mockImplementation(async record => {
      await indexedDbFacadeMock.saveRecord(record);
      return {
        ok: true,
        operation: 'save',
        store: 'indexeddb',
        dates: [record.date],
      };
    });
    vi.mocked(firestoreService.getRecordFromFirestore).mockResolvedValue(null);
    vi.mocked(firestoreService.getRecordFromFirestoreDetailed).mockImplementation(
      async (date: string) => {
        try {
          const record = await vi.mocked(firestoreService.getRecordFromFirestore)(date);
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
      }
    );
  });

  it('returns from IndexedDB if available', async () => {
    vi.mocked(idbService.getRecordForDate).mockResolvedValue(mockRecord);
    const result = await Repository.getForDate(mockDate);
    expect(result).toMatchObject({
      ...mockRecord,
      beds: expect.any(Object),
    });
    expect(idbService.getRecordForDate).toHaveBeenCalledWith(mockDate);
  });

  it('falls back to Firestore if not in IndexedDB', async () => {
    vi.mocked(idbService.getRecordForDate).mockResolvedValue(null);
    vi.mocked(firestoreService.getRecordFromFirestore).mockResolvedValue(mockRecord);

    const result = await Repository.getForDate(mockDate);
    expect(result).toMatchObject({
      ...mockRecord,
      beds: expect.any(Object),
    });
    expect(idbService.saveRecord).toHaveBeenCalled();
  });

  it('returns source metadata via getForDateWithMeta', async () => {
    vi.mocked(idbService.getRecordForDate).mockResolvedValue(mockRecord);

    const result = await Repository.getForDateWithMeta(mockDate);

    expect(result.source).toBe('indexeddb');
    expect(result.compatibilityTier).toBe('local_runtime');
    expect(result.compatibilityIntensity).toBe('normalized_only');
    expect(result.record?.date).toBe(mockDate);
  });

  it('returns previous day metadata via getPreviousDayWithMeta', async () => {
    vi.mocked(idbService.getPreviousDayRecord).mockResolvedValue({
      ...mockRecord,
      date: '2024-12-31',
    });

    const result = await Repository.getPreviousDayWithMeta(mockDate);

    expect(result.source).toBe('indexeddb');
    expect(result.compatibilityTier).toBe('local_runtime');
    expect(result.record?.date).toBe('2024-12-31');
  });

  it('returns null if no previous day found', async () => {
    vi.mocked(idbService.getPreviousDayRecord).mockResolvedValue(null);
    const result = await Repository.getPreviousDay(mockDate);
    expect(result).toBeNull();
  });

  it('returns previous day from IDB if it exists', async () => {
    vi.mocked(idbService.getPreviousDayRecord).mockResolvedValue({
      ...mockRecord,
      date: '2024-12-31',
    });

    const result = await Repository.getPreviousDay(mockDate);
    expect(result).not.toBeNull();
    expect(result?.date).toBe('2024-12-31');
  });

  it('pulls from firestore and saves locally during sync', async () => {
    vi.mocked(firestoreService.getRecordFromFirestore).mockResolvedValueOnce(mockRecord);

    const result = await Repository.syncWithFirestore(mockDate);

    expect(result).toMatchObject({
      ...mockRecord,
      beds: expect.any(Object),
    });
    expect(idbService.saveRecord).toHaveBeenCalled();
  });

  it('returns null when remote Firestore record is missing and legacy is isolated from sync hot path', async () => {
    vi.mocked(firestoreService.getRecordFromFirestore).mockResolvedValueOnce(null);
    vi.mocked(legacyRecordBridge.getLegacyRecord).mockResolvedValueOnce(mockRecord);

    const result = await Repository.syncWithFirestore(mockDate);

    expect(result).toBeNull();
    expect(legacyRecordBridge.getLegacyRecord).not.toHaveBeenCalled();
  });

  it('keeps the newer local record when remote sync returns older data', async () => {
    const newerLocalRecord = {
      ...mockRecord,
      lastUpdated: `${mockDate}T12:00:00.000Z`,
    };
    const olderRemoteRecord = {
      ...mockRecord,
      lastUpdated: `${mockDate}T08:00:00.000Z`,
    };

    vi.mocked(idbService.getRecordForDate).mockImplementation(async () => newerLocalRecord);
    vi.mocked(firestoreService.getRecordFromFirestore).mockResolvedValueOnce(olderRemoteRecord);

    const result = await Repository.syncWithFirestore(mockDate);

    expect(result?.lastUpdated).toBe(`${mockDate}T12:00:00.000Z`);
  });

  it('bridges legacy data only through the explicit bridge API', async () => {
    vi.mocked(legacyRecordBridge.getLegacyRecord).mockResolvedValueOnce(mockRecord);

    const result = await Repository.bridgeLegacyRecord(mockDate);

    expect(result.source).toBe('legacy_bridge');
    expect(result.record).toMatchObject({
      ...mockRecord,
      beds: expect.any(Object),
    });
    expect(legacyRecordBridge.getLegacyRecord).toHaveBeenCalledWith(mockDate);
    expect(idbService.saveRecord).toHaveBeenCalled();
  });

  it('returns combined dates from local and remote', async () => {
    vi.mocked(idbService.getAllDates).mockResolvedValue(['2025-01-01']);
    const dates = await Repository.getAvailableDates();
    expect(dates).toContain('2025-01-01');
  });

  it('saves nurses to local and remote', async () => {
    await CatalogRepository.saveNurses(['N1']);
    expect(idbService.saveCatalog).toHaveBeenCalledWith('nurses', ['N1']);
    expect(firestoreService.saveNurseCatalogToFirestore).toHaveBeenCalledWith(['N1']);
  });

  it('saves TENS to local and remote', async () => {
    await CatalogRepository.saveTens(['T1']);
    expect(idbService.saveCatalog).toHaveBeenCalledWith('tens', ['T1']);
    expect(firestoreService.saveTensCatalogToFirestore).toHaveBeenCalledWith(['T1']);
  });

  it('provides subscribe methods', () => {
    const cb = vi.fn();
    const unsub = CatalogRepository.subscribeNurses(cb);
    expect(firestoreService.subscribeToNurseCatalog).toHaveBeenCalled();
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('allows toggling firestore', () => {
    Repository.setFirestoreEnabled(false);
    expect(Repository.isFirestoreEnabled()).toBe(false);
    Repository.setFirestoreEnabled(true);
    expect(Repository.isFirestoreEnabled()).toBe(true);
  });

  it('rejects invalid date format on getForDate', async () => {
    await expect(Repository.getForDate('19-02-2026')).rejects.toThrow(/Invalid date format/);
  });

  it('rejects invalid date format on deleteDay', async () => {
    await expect(Repository.deleteDay('2026/02/19')).rejects.toThrow(/Invalid date format/);
  });

  it('keeps patient builders available for compatibility-heavy reads', () => {
    expect(buildPatient({ patientName: 'Paciente' }).patientName).toBe('Paciente');
  });
});
