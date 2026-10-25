import { vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';
vi.mock(
  '@/services/storage/firestore/firestoreDailyRecordAuthorityRouting',
  async importOriginal => ({
    ...(await importOriginal<
      typeof import('@/services/storage/firestore/firestoreDailyRecordAuthorityRouting')
    >()),
    shouldRouteSpecialistPatchViaCallable: vi.fn().mockResolvedValue(false),
  })
);
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDate: vi.fn(),
  saveRecord: vi.fn(),
  saveRecordStrict: vi.fn(record =>
    Promise.resolve({
      ok: true,
      operation: 'save',
      store: 'indexeddb',
      dates: [record.date],
    })
  ),
}));
vi.mock('@/services/storage/firestore/firestoreRecordWrites', () => ({
  updateRecordPartial: vi.fn(),
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: vi.fn(),
}));
vi.mock('@/services/storage/sync', () => ({
  ackDailyRecordSyncTask: vi.fn().mockResolvedValue(true),
  isRetryableSyncError: vi.fn(),
  queueSyncTask: vi.fn().mockResolvedValue({
    accepted: true,
    mode: 'created',
    pendingTasks: 1,
    maxPendingTasks: 1000,
  }),
  queueDailyRecordSyncTaskWithLocalRecord: vi.fn().mockResolvedValue({
    accepted: true,
    mode: 'created',
    pendingTasks: 1,
    maxPendingTasks: 1000,
  }),
  getPendingDailyRecordSyncTaskSnapshot: vi.fn().mockResolvedValue(null),
  replacePendingDailyRecordSyncTaskWithLocalRecord: vi.fn().mockResolvedValue(false),
  adoptAuthoritativeDailyRecordAtomically: vi.fn().mockImplementation(async record => ({
    status: 'adopted',
    record,
  })),
  releaseDailyRecordPreOutboxHold: vi.fn().mockResolvedValue(true),
  renewDailyRecordPreOutboxHold: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({
  isFirestoreEnabled: vi.fn(() => true),
  getFirestoreSyncState: vi.fn(() => ({ mode: 'enabled', reason: 'ready' })),
}));
vi.mock('@/utils/recordInvariants', () => ({
  normalizeDailyRecordInvariants: vi.fn((record: DailyRecord) => ({ record, patches: {} })),
}));
vi.mock('@/services/repositories/helpers/validationHelper', () => ({
  validateAndSalvageRecord: vi.fn((record: DailyRecord) => record),
}));
vi.mock('@/services/utils/fhirMappers', () => ({
  mapPatientToFhir: vi.fn(() => ({})),
}));
const buildRecord = (date: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2026-02-19T00:00:00.000Z',
  nurses: [],
  activeExtraBeds: [],
});
const buildPatient = (bedId: string, patientName: string): PatientData => ({
  bedId,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName,
  rut: '11.111.111-1',
  age: '40a',
  pathology: 'Diagnostico',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-02-18',
  hasWristband: false,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
});

export { buildRecord, buildPatient };
