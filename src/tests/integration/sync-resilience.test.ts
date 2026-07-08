import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { PatientStatus, Specialty } from '@/types/domain/patientClassification';

const { mockSaveDailyRecordWithClinicalAuthorityCallable } = vi.hoisted(() => ({
  mockSaveDailyRecordWithClinicalAuthorityCallable: vi.fn(),
}));

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    setDoc: vi.fn().mockResolvedValue(undefined),
    getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined }),
  };
});

vi.mock('@/services/storage/firestore/firestoreShared', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/services/storage/firestore/firestoreShared')>();
  return {
    ...actual,
    getRecordDocRef: vi.fn(() => ({ id: 'sync-test-doc-ref' })),
    sanitizeForFirestore: vi.fn(value => value),
  };
});

vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: vi.fn(),
}));

vi.mock('@/services/storage/firestore/firestoreRecordWrites', () => ({
  saveRecordToFirestore: vi.fn(),
  updateRecordPartial: vi.fn(),
}));

vi.mock('@/services/storage/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/storage/firestore')>();
  return {
    ...actual,
    getRecordFromFirestore: vi.fn(),
    saveRecordToFirestore: vi.fn(),
    updateRecordPartial: vi.fn(),
  };
});

vi.mock('@/services/repositories/ports/repositoryAuditPort', () => ({
  logRepositoryConflictAutoMerged: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/storage/firestore/dailyRecordAuthorityCallableClient', () => ({
  saveDailyRecordWithClinicalAuthorityCallable: (...args: unknown[]) =>
    mockSaveDailyRecordWithClinicalAuthorityCallable(...args),
}));

import { setDoc } from 'firebase/firestore';
import {
  hospitalDB,
  clearAllRecords,
  saveRecord as saveRecordLocal,
} from '@/services/storage/indexedDBService';
import { getSyncQueueTelemetry, processSyncQueue, queueSyncTask } from '@/services/storage/sync';
import { getRecordFromFirestore } from '@/services/storage/firestore/firestoreRecordQueries';
import { updateRecordPartial as updateRecordPartialToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';
import { updatePartial } from '@/services/repositories/dailyRecordRepositoryWriteService';

const buildPatient = (bedId: string, overrides: Partial<PatientData> = {}): PatientData => ({
  bedId,
  isBlocked: false,
  bedMode: 'Cama',
  hasCompanionCrib: false,
  patientName: 'Paciente',
  rut: '11.111.111-1',
  age: '40a',
  pathology: 'Diagnostico',
  specialty: Specialty.MEDICINA,
  status: PatientStatus.ESTABLE,
  admissionDate: '2026-02-19',
  hasWristband: false,
  devices: [],
  surgicalComplication: false,
  isUPC: false,
  ...overrides,
});

const buildRecord = (date: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2026-02-19T10:00:00.000Z',
  nurses: ['', ''],
  nursesDayShift: ['', ''],
  nursesNightShift: ['', ''],
  tensDayShift: ['', '', ''],
  tensNightShift: ['', '', ''],
  activeExtraBeds: [],
  schemaVersion: 1,
  dateTimestamp: Date.parse(`${date}T00:00:00.000Z`),
  handoffDayChecklist: {},
  handoffNightChecklist: {},
});

describe('Sync resilience integration', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockSaveDailyRecordWithClinicalAuthorityCallable.mockResolvedValue({ success: true });
    await clearAllRecords();
    await hospitalDB.syncQueue.clear();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  });

  const isAuthorityCallableMode = () =>
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE ===
      'enforced' ||
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_CALLABLE ===
      'true';

  const expectOnePublishAttempt = () => {
    if (isAuthorityCallableMode()) {
      expect(mockSaveDailyRecordWithClinicalAuthorityCallable).toHaveBeenCalledTimes(1);
      expect(vi.mocked(setDoc)).not.toHaveBeenCalled();
      return;
    }

    expect(vi.mocked(setDoc)).toHaveBeenCalledTimes(1);
    expect(mockSaveDailyRecordWithClinicalAuthorityCallable).not.toHaveBeenCalled();
  };

  it('queues while offline and flushes successfully when back online', async () => {
    const record = buildRecord('2026-02-19');
    record.beds.R1 = buildPatient('R1');

    await queueSyncTask('UPDATE_DAILY_RECORD', record);

    let telemetry = await getSyncQueueTelemetry();
    expect(telemetry.pending).toBe(1);
    expect(vi.mocked(setDoc)).not.toHaveBeenCalled();

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await processSyncQueue();

    telemetry = await getSyncQueueTelemetry();
    expectOnePublishAttempt();
    expect(telemetry.pending).toBe(0);
    expect(telemetry.failed).toBe(0);
  });

  it('marks permission-denied as FAILED without retry loop', async () => {
    vi.mocked(setDoc).mockRejectedValue({
      code: 'permission-denied',
      message: 'Missing or insufficient permissions',
    });
    mockSaveDailyRecordWithClinicalAuthorityCallable.mockRejectedValue({
      code: 'permission-denied',
      message: 'Missing or insufficient permissions',
    });

    await queueSyncTask('UPDATE_DAILY_RECORD', buildRecord('2026-02-18'));
    await processSyncQueue();
    await processSyncQueue();

    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('FAILED');
    expect(tasks[0].retryCount).toBe(0);
    expectOnePublishAttempt();
  });

  it('auto-merges same-episode explicit clinical patches while preserving remote bed state', async () => {
    const date = '2026-02-17';

    const local = buildRecord(date);
    local.beds.R1 = buildPatient('R1', {
      pathology: 'Diagnostico local',
      bedMode: 'Cuna',
    });

    const remote = buildRecord(date);
    remote.beds.R1 = buildPatient('R1', {
      pathology: 'Diagnostico remoto',
      bedMode: 'Cama',
    });

    await saveRecordLocal(local);

    const conflictError = new Error('Concurrency conflict');
    conflictError.name = 'ConcurrencyError';

    vi.mocked(updateRecordPartialToFirestore).mockRejectedValueOnce(conflictError);
    vi.mocked(getRecordFromFirestore).mockResolvedValue(remote);

    await updatePartial(date, {
      'beds.R1.pathology': 'Diagnostico local',
    });

    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);

    const mergedPayload = tasks[0].payload as DailyRecord;
    expect(mergedPayload.beds.R1.pathology).toBe('Diagnostico local');
    expect(mergedPayload.beds.R1.bedMode).toBe('Cama');
    expect(tasks[0].contexts).toEqual(['clinical']);
    expect(tasks[0].origin).toBe('conflict_auto_merge');
    expect(tasks[0].syncContract).toEqual(
      expect.objectContaining({
        expectedVersion: remote.lastUpdated,
        recordRevision: mergedPayload.lastUpdated,
        changedPaths: expect.arrayContaining(['beds.R1.pathology']),
      })
    );
  });
});
