vi.unmock('@/services/repositories/dailyRecordRepositoryReadService');
vi.unmock('@/services/repositories/dailyRecordRepositoryWriteService');
vi.unmock('@/services/repositories/dailyRecordRepositoryInitializationService');
vi.unmock('@/services/repositories/dailyRecordRepositorySyncService');
vi.unmock('@/services/repositories/CatalogRepository');

import { vi } from 'vitest';
import {
  copyPatientToDate,
  copyPatientToDateDetailed,
  initializeDay,
  initializeDayDetailed,
} from '@/services/repositories/dailyRecordRepositoryInitializationService';
import { deleteDailyRecordAcrossStores as deleteDay } from '@/services/repositories/dailyRecordRepositoryFacadeSupport';
import { isFirestoreEnabled, setFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { save, updatePartial } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { syncWithFirestore } from '@/services/repositories/dailyRecordRepositorySyncService';
import {
  bridgeLegacyRecordForDate,
  getAvailableDates,
  getForDate,
  getForDateWithMeta,
  getPreviousDay,
  getPreviousDayWithMeta,
} from '@/services/repositories/dailyRecordRepositoryReadService';
import { CatalogRepository } from '@/services/repositories/CatalogRepository';
import * as idbService from '@/services/storage/indexedDBService';
import * as firestoreService from '@/services/storage/firestore';
import type { CudyrScore } from '@/types/domain/cudyr';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

const { legacyFirebaseMock, indexedDbFacadeMock, firestoreMock, logErrorMock } = vi.hoisted(() => ({
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
    deleteRecordStrict: vi.fn(),
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
  logErrorMock: vi.fn(),
}));

vi.mock('@/services/utils/errorService', () => ({
  logError: logErrorMock,
}));

export { firestoreMock, indexedDbFacadeMock, legacyFirebaseMock, logErrorMock };

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
  deleteRecordStrict: indexedDbFacadeMock.deleteRecordStrict,
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
vi.mock('@/services/storage/sync', () => ({
  ackDailyRecordSyncTask: vi.fn().mockResolvedValue(true),
  isRetryableSyncError: vi.fn(() => false),
  queueSyncTask: vi.fn().mockResolvedValue({
    accepted: true,
    mode: 'created',
    pendingTasks: 1,
    maxPendingTasks: 1000,
  }),
  queueDailyRecordSyncTaskWithLocalRecord: vi.fn(async (record: DailyRecord) => {
    await indexedDbFacadeMock.saveRecordStrict(record);
    return {
      accepted: true,
      mode: 'created',
      pendingTasks: 1,
      maxPendingTasks: 1000,
    };
  }),
  releaseDailyRecordPreOutboxHold: vi.fn().mockResolvedValue(true),
  renewDailyRecordPreOutboxHold: vi.fn().mockResolvedValue(true),
}));

export const Repository = {
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
  CatalogRepository,
};

export const mockDate = '2025-01-01';

export const buildCudyr = (overrides: Partial<CudyrScore> = {}): CudyrScore => ({
  changeClothes: 0,
  mobilization: 0,
  feeding: 0,
  elimination: 0,
  psychosocial: 0,
  surveillance: 0,
  vitalSigns: 0,
  fluidBalance: 0,
  oxygenTherapy: 0,
  airway: 0,
  proInterventions: 0,
  skinCare: 0,
  pharmacology: 0,
  invasiveElements: 0,
  ...overrides,
});

export const buildPatient = (overrides: Partial<PatientData> = {}): PatientData => ({
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

export const mockRecord: DailyRecord = {
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

export const resetDailyRecordRepositoryLifecycleState = () => {
  vi.clearAllMocks();
  vi.mocked(idbService.getRecordForDate).mockReset();
  vi.mocked(idbService.getPreviousDayRecord).mockReset();
  vi.mocked(idbService.saveRecord).mockReset();
  vi.mocked(indexedDbFacadeMock.saveRecordStrict).mockReset();
  vi.mocked(indexedDbFacadeMock.deleteRecordStrict).mockReset();
  vi.mocked(firestoreService.getRecordFromFirestore).mockReset();
  vi.mocked(firestoreService.saveRecordToFirestore).mockReset();
  vi.mocked(firestoreService.updateRecordPartial).mockReset();

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
  vi.mocked(indexedDbFacadeMock.deleteRecordStrict).mockImplementation(async date => {
    await indexedDbFacadeMock.deleteRecord(date);
    return {
      ok: true,
      operation: 'delete',
      store: 'indexeddb',
      dates: [date],
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
};
