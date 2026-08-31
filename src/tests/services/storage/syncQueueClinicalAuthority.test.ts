import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexedDBService';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const { mockAuthorityCallable, mockHttpsCallable, mockGetFunctions } = vi.hoisted(() => ({
  mockAuthorityCallable: vi.fn().mockResolvedValue({
    data: {
      success: true,
      date: '2025-01-17',
      mode: 'enforced',
      authorityStatus: 'ok',
    },
  }),
  mockHttpsCallable: vi.fn(),
  mockGetFunctions: vi.fn().mockResolvedValue({ name: 'functions-runtime' }),
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
    getRecordDocRef: vi.fn(() => ({ id: 'sync-authority-doc-ref' })),
    sanitizeForFirestore: vi.fn(value => value),
  };
});

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => mockHttpsCallable(...args),
}));

vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: {
    getFunctions: () => mockGetFunctions(),
    getRegionalFunctions: () => mockGetFunctions(),
  },
}));

import { getDoc, setDoc } from 'firebase/firestore';
import { processSyncQueue, queueSyncTask } from '@/services/storage/sync';

const makeRecord = (date: string): DailyRecord =>
  ({
    date,
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: `${date}T10:10:00.000Z`,
    nurses: [],
    activeExtraBeds: [],
  }) as DailyRecord;

describe('sync queue clinical authority', () => {
  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
    vi.clearAllMocks();
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => false,
      data: () => undefined,
    } as Awaited<ReturnType<typeof getDoc>>);
    vi.mocked(setDoc).mockResolvedValue(undefined);
    mockHttpsCallable.mockReturnValue(mockAuthorityCallable);
    mockAuthorityCallable.mockResolvedValue({
      data: {
        success: true,
        date: '2025-01-17',
        mode: 'enforced',
        authorityStatus: 'ok',
        recordState: {
          record: makeRecord('2025-01-17'),
          lastUpdated: '2025-01-17T10:10:00.000Z',
          meta: {},
        },
      },
    });
    delete (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE;
    delete (import.meta.env as Record<string, string | undefined>)
      .VITE_DAILY_RECORD_AUTHORITY_CALLABLE;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  });

  it('keeps sync tasks in conflict when clinical authority blocks the publish', async () => {
    const local = makeRecord('2025-01-16');
    local.beds.R1 = {
      bedId: 'R1',
      patientName: 'Paciente Cerrado',
      rut: '44.444.444-4',
      age: '70a',
      pathology: 'Diagnostico local',
      specialty: 'Medicina',
      status: 'Estable',
      admissionDate: '2025-01-16',
      admissionTime: '09:00',
      clinicalEpisodeId: 'ep-closed-active',
      isBlocked: false,
      bedMode: 'Cama',
      hasCompanionCrib: false,
      hasWristband: true,
      devices: [],
      surgicalComplication: false,
      isUPC: false,
    } as DailyRecord['beds'][string];
    local.discharges = [
      {
        id: 'discharge-closed',
        bedId: 'R1',
        bedName: 'R1',
        bedType: 'Cama',
        patientName: 'Paciente Cerrado',
        rut: '44.444.444-4',
        diagnosis: 'Diagnostico local',
        time: '10:00',
        status: 'Vivo',
        clinicalEpisodeId: 'ep-closed-active',
      },
    ];

    await queueSyncTask('UPDATE_DAILY_RECORD', local, {
      contexts: ['clinical'],
      origin: 'full_save_retry',
    });

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await processSyncQueue();

    expect(setDoc).not.toHaveBeenCalled();
    const [task] = await hospitalDB.syncQueue.toArray();
    expect(task.status).toBe('CONFLICT');
    expect(task.lastErrorCategory).toBe('conflict');
    expect(task.error).toContain('clinical authority');
  });

  it('publishes valid outbox daily records through the authority callable in enforced mode', async () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'enforced';
    const local = makeRecord('2025-01-17');
    local.beds.R1 = {
      bedId: 'R1',
      patientName: 'Paciente Validado',
      rut: '55.555.555-5',
      age: '60a',
      pathology: 'Diagnostico local',
      specialty: 'Medicina',
      status: 'Estable',
      admissionDate: '2025-01-17',
      admissionTime: '08:00',
      clinicalEpisodeId: 'ep-valid-outbox',
      isBlocked: false,
      bedMode: 'Cama',
      hasCompanionCrib: false,
      hasWristband: true,
      devices: [],
      surgicalComplication: false,
      isUPC: false,
    } as DailyRecord['beds'][string];

    await queueSyncTask('UPDATE_DAILY_RECORD', local, {
      contexts: ['clinical'],
      origin: 'full_save_retry',
      syncContract: {
        expectedVersion: '2025-01-17T10:00:00.000Z',
        changedPaths: ['beds.R1.pathology'],
      },
    });

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await processSyncQueue();

    expect(setDoc).not.toHaveBeenCalled();
    expect(mockGetFunctions).toHaveBeenCalled();
    expect(mockHttpsCallable).toHaveBeenCalledWith(
      { name: 'functions-runtime' },
      'saveDailyRecordWithClinicalAuthority',
      { timeout: 45_000 }
    );
    expect(mockAuthorityCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2025-01-17',
        expectedLastUpdated: '2025-01-17T10:00:00.000Z',
        mode: 'enforced',
        origin: 'full_save_retry',
        record: expect.objectContaining({ date: '2025-01-17' }),
        syncContract: expect.objectContaining({
          expectedVersion: '2025-01-17T10:00:00.000Z',
          changedPaths: ['beds.R1.pathology'],
          clinicalEpisodeKeys: ['ep-valid-outbox'],
        }),
      })
    );
  });

  it('runs shadow authority validation but keeps direct outbox publish when shadow fails', async () => {
    (import.meta.env as Record<string, string | undefined>).VITE_DAILY_RECORD_AUTHORITY_MODE =
      'shadow';
    mockAuthorityCallable.mockRejectedValueOnce(new Error('shadow unavailable'));
    const local = makeRecord('2025-01-18');
    local.beds.R1 = {
      bedId: 'R1',
      patientName: 'Paciente Shadow',
      rut: '66.666.666-6',
      age: '61a',
      pathology: 'Diagnostico local',
      specialty: 'Medicina',
      status: 'Estable',
      admissionDate: '2025-01-18',
      admissionTime: '08:00',
      clinicalEpisodeId: 'ep-shadow-outbox',
      isBlocked: false,
      bedMode: 'Cama',
      hasCompanionCrib: false,
      hasWristband: true,
      devices: [],
      surgicalComplication: false,
      isUPC: false,
    } as DailyRecord['beds'][string];

    await queueSyncTask('UPDATE_DAILY_RECORD', local, {
      contexts: ['clinical'],
      origin: 'full_save_retry',
      syncContract: {
        expectedVersion: '2025-01-18T10:00:00.000Z',
        changedPaths: ['beds.R1.pathology'],
      },
    });

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await processSyncQueue();

    expect(mockAuthorityCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2025-01-18',
        dryRun: true,
        expectedLastUpdated: '2025-01-18T10:00:00.000Z',
        mode: 'shadow',
        origin: 'full_save_retry',
        record: expect.objectContaining({ date: '2025-01-18' }),
        syncContract: expect.objectContaining({
          expectedVersion: '2025-01-18T10:00:00.000Z',
          changedPaths: ['beds.R1.pathology'],
          clinicalEpisodeKeys: ['ep-shadow-outbox'],
        }),
      })
    );
    expect(setDoc).toHaveBeenCalledWith(
      { id: 'sync-authority-doc-ref' },
      expect.objectContaining({ date: '2025-01-18' }),
      { merge: true }
    );
    expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
  });
});
