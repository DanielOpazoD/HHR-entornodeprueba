import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async importOriginal => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined }),
    setDoc: vi.fn().mockResolvedValue(undefined),
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

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

vi.mock('@/shared/runtime/e2eRuntime', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/runtime/e2eRuntime')>()),
  isE2ERuntimeEnabled: () => true,
}));

import { getDoc, setDoc } from 'firebase/firestore';
import { hospitalDB } from '@/services/storage/indexedDBService';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { localPersistence } from '@/services/storage/localpersistence/localPersistenceService';
import {
  processSyncQueue,
  queueDailyRecordSyncTaskWithLocalRecord,
  queueSyncTask,
} from '@/services/storage/sync';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { adoptAuthoritativeRecord } from '@/services/repositories/dailyRecordRepositorySyncService';
import { DataFactory } from '@/tests/factories/DataFactory';
import { getDailyRecordWriteStateForVersion } from '@/services/storage/sync/dailyRecordSyncQueueReadService';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const TEST_TASK_TIMESTAMP_MS = 1760000000000;
const FRESH_WORKER_NOW_MS = 1760000060000;
const FRESH_WORKER_LEASE_UNTIL_MS = FRESH_WORKER_NOW_MS + 30_000;

const makeRecord = (date: string, marker: string): DailyRecord => ({
  date,
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: marker,
  nurses: [],
  activeExtraBeds: [],
});

describe('sync queue transactional outbox and leases', () => {
  beforeEach(async () => {
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    localStorage.clear();
    window.__HHR_E2E_OVERRIDE__ = undefined;
    vi.clearAllMocks();
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => false,
      data: () => undefined,
    } as Awaited<ReturnType<typeof getDoc>>);
    vi.mocked(setDoc).mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  });

  it('persists a local daily record and its outbox task in one operation', async () => {
    const record = makeRecord('2025-01-16', '2025-01-16T10:00:00.000Z');

    const result = await queueDailyRecordSyncTaskWithLocalRecord(record, {
      contexts: ['clinical'],
      origin: 'partial_update_retry',
      syncContract: {
        expectedVersion: '2025-01-16T09:00:00.000Z',
        changedPaths: ['beds.R1.pathology'],
      },
    });

    expect(result).toMatchObject({
      accepted: true,
      mode: 'created',
    });
    await expect(hospitalDB.dailyRecords.get('2025-01-16')).resolves.toMatchObject({
      lastUpdated: '2025-01-16T10:00:00.000Z',
    });
    await expect(hospitalDB.syncQueue.toArray()).resolves.toHaveLength(1);
  });

  it('keeps IndexedDB persistence successful when the legacy mirror is over quota', async () => {
    const record = makeRecord('2025-01-26', '2025-01-26T10:00:00.000Z');
    window.__HHR_E2E_OVERRIDE__ = {};
    const mirrorSaveSpy = vi.spyOn(localPersistence.records, 'save').mockImplementationOnce(() => {
      throw new DOMException('Legacy mirror quota exceeded', 'QuotaExceededError');
    });
    const storeChanges: Array<{ operation: string; dates?: string[] }> = [];
    const onStoreChange = (event: Event) => {
      storeChanges.push((event as CustomEvent<{ operation: string; dates?: string[] }>).detail);
    };

    window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, onStoreChange);
    try {
      const result = await queueDailyRecordSyncTaskWithLocalRecord(record, {
        contexts: ['clinical'],
        origin: 'partial_update_retry',
        syncContract: {
          changedPaths: ['beds.R1.pathology'],
        },
      });

      expect(result).toMatchObject({ accepted: true, mode: 'created' });
      await expect(hospitalDB.dailyRecords.get(record.date)).resolves.toMatchObject({
        lastUpdated: record.lastUpdated,
      });
      await expect(hospitalDB.syncQueue.toArray()).resolves.toHaveLength(1);
      expect(storeChanges).toContainEqual({ operation: 'save', dates: [record.date] });
      expect(mirrorSaveSpy).toHaveBeenCalledWith(record);
    } finally {
      window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, onStoreChange);
      window.__HHR_E2E_OVERRIDE__ = undefined;
      mirrorSaveSpy.mockRestore();
    }
  });

  it('rolls back the outbox task when the local record write fails', async () => {
    const record = makeRecord('2025-01-17', '2025-01-17T10:00:00.000Z');
    const store = createDexieSyncQueueStore();
    const putSpy = vi
      .spyOn(hospitalDB.dailyRecords, 'put')
      .mockRejectedValueOnce(new Error('record write failed'));

    await expect(
      store.saveDailyRecordWithTask(record, {
        opId: 'test-op',
        type: 'UPDATE_DAILY_RECORD',
        payload: record,
        timestamp: TEST_TASK_TIMESTAMP_MS,
        retryCount: 0,
        status: 'PENDING',
        key: 'daily:2025-01-17',
      })
    ).rejects.toThrow('record write failed');

    await expect(hospitalDB.dailyRecords.get('2025-01-17')).resolves.toBeUndefined();
    await expect(hospitalDB.syncQueue.toArray()).resolves.toHaveLength(0);
    putSpy.mockRestore();
  });

  it('rolls back the local record when the outbox task write fails', async () => {
    const record = makeRecord('2025-01-18', '2025-01-18T10:00:00.000Z');
    const store = createDexieSyncQueueStore();
    const addSpy = vi
      .spyOn(hospitalDB.syncQueue, 'add')
      .mockRejectedValueOnce(new Error('queue write failed'));

    await expect(
      store.saveDailyRecordWithTask(record, {
        opId: 'test-op',
        type: 'UPDATE_DAILY_RECORD',
        payload: record,
        timestamp: TEST_TASK_TIMESTAMP_MS,
        retryCount: 0,
        status: 'PENDING',
        key: 'daily:2025-01-18',
      })
    ).rejects.toThrow('queue write failed');

    await expect(hospitalDB.dailyRecords.get('2025-01-18')).resolves.toBeUndefined();
    await expect(hospitalDB.syncQueue.toArray()).resolves.toHaveLength(0);
    addSpy.mockRestore();
  });

  it('removes a stale queued crib create before adopting an already-cleared remote record', async () => {
    const date = '2025-01-27';
    window.__HHR_E2E_OVERRIDE__ = {};
    const localCrib = DataFactory.createMockPatient('R1', {
      bedMode: 'Cuna',
      clinicalEpisodeId: 'crib-pending',
      patientName: 'RN local pendiente',
      rut: '',
    });
    const localRecord = DataFactory.createMockDailyRecord(date, {
      ...makeRecord(date, '2025-01-27T10:00:00.000Z'),
      nursesDayShift: ['Turno local antiguo'],
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: 'parent-episode',
          pathology: 'Edición local pendiente',
          clinicalCrib: localCrib,
        }),
      },
    });
    const remoteRecord = DataFactory.createMockDailyRecord(date, {
      ...localRecord,
      lastUpdated: '2025-01-27T10:00:01.000Z',
      nursesDayShift: ['Turno remoto vigente'],
      beds: {
        R1: {
          ...localRecord.beds.R1,
          pathology: 'Versión remota anterior',
          clinicalCrib: undefined,
        },
      },
    });
    await queueDailyRecordSyncTaskWithLocalRecord(localRecord, {
      contexts: ['clinical'],
      origin: 'partial_update_retry',
      syncContract: {
        expectedVersion: '2025-01-27T09:59:59.000Z',
        changedPaths: ['beds.R1.pathology', 'beds.R1.clinicalCrib'],
      },
    });
    const storedBeforeClear = await hospitalDB.dailyRecords.get(date);
    const [taskBeforeClear] = await hospitalDB.syncQueue.toArray();
    expect((taskBeforeClear.payload as DailyRecord).lastUpdated).toBe(
      storedBeforeClear?.lastUpdated
    );
    await expect(
      getDailyRecordWriteStateForVersion(date, storedBeforeClear!.lastUpdated)
    ).resolves.toBe('active');

    const projection = await adoptAuthoritativeRecord(remoteRecord, {
      'beds.R1.clinicalCrib': null,
    });
    expect(projection.beds.R1.pathology).toBe('Edición local pendiente');
    expect(projection.beds.R1.clinicalCrib).toBeFalsy();
    expect(projection.nursesDayShift).toEqual(['Turno remoto vigente']);

    const [task] = await hospitalDB.syncQueue.toArray();
    const queuedRecord = task.payload as DailyRecord;
    expect(task.status).toBe('PENDING');
    expect(queuedRecord.beds.R1.pathology).toBe('Edición local pendiente');
    expect(queuedRecord.beds.R1.clinicalCrib).toBeFalsy();
    expect(queuedRecord.nursesDayShift).toEqual(['Turno remoto vigente']);
    expect(task.syncContract).toEqual(
      expect.objectContaining({
        expectedVersion: remoteRecord.lastUpdated,
        changedPaths: expect.arrayContaining(['beds.R1.pathology', 'beds.R1.clinicalCrib']),
      })
    );
    await expect(hospitalDB.dailyRecords.get(date)).resolves.toMatchObject({
      beds: { R1: { pathology: 'Edición local pendiente' } },
    });
  });

  it('fails closed when the stale queued crib create has already begun processing', async () => {
    const date = '2025-01-28';
    window.__HHR_E2E_OVERRIDE__ = {};
    const localRecord = DataFactory.createMockDailyRecord(date, {
      ...makeRecord(date, '2025-01-28T10:00:00.000Z'),
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: 'parent-episode',
          clinicalCrib: DataFactory.createMockPatient('R1', {
            bedMode: 'Cuna',
            clinicalEpisodeId: 'crib-processing',
            patientName: 'RN procesando',
            rut: '',
          }),
        }),
      },
    });
    const remoteRecord = DataFactory.createMockDailyRecord(date, {
      ...localRecord,
      lastUpdated: '2025-01-28T10:00:01.000Z',
      beds: {
        R1: { ...localRecord.beds.R1, clinicalCrib: undefined },
      },
    });
    await queueDailyRecordSyncTaskWithLocalRecord(localRecord);
    await hospitalDB.syncQueue
      .where('status')
      .equals('PENDING')
      .modify(task => {
        task.status = 'PROCESSING';
      });

    await expect(
      adoptAuthoritativeRecord(remoteRecord, { 'beds.R1.clinicalCrib': null })
    ).rejects.toThrow('sincronización local pendiente');

    const [task] = await hospitalDB.syncQueue.toArray();
    expect((task.payload as DailyRecord).beds.R1.clinicalCrib?.patientName).toBe('RN procesando');
  });

  it('claims ready pending tasks with a durable lease so another worker cannot claim them', async () => {
    const store = createDexieSyncQueueStore();
    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-19', 'v1'));
    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-20', 'v1'));

    const firstClaim = await store.claimReadyPending(1760000000000, 1, null, {
      leaseOwner: 'worker-a',
      leaseUntil: 1760000030000,
      attemptId: 'attempt-a',
    });
    const secondClaim = await store.claimReadyPending(1760000000000, 2, null, {
      leaseOwner: 'worker-b',
      leaseUntil: 1760000030000,
      attemptId: 'attempt-b',
    });

    expect(firstClaim).toHaveLength(1);
    expect(firstClaim[0]).toMatchObject({
      status: 'PROCESSING',
      leaseOwner: 'worker-a',
      attemptId: 'attempt-a',
    });
    expect(secondClaim).toHaveLength(1);
    expect(secondClaim[0].key).not.toBe(firstClaim[0].key);
  });

  it('reclaims expired processing leases', async () => {
    const store = createDexieSyncQueueStore();
    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-21', 'v1'));
    await hospitalDB.syncQueue
      .where('status')
      .equals('PENDING')
      .modify(task => {
        task.status = 'PROCESSING';
        task.leaseOwner = 'stale-worker';
        task.leaseUntil = 1760000000000 - 1;
        task.attemptId = 'stale-attempt';
      });

    const reclaimed = await store.claimReadyPending(1760000000000, 1, null, {
      leaseOwner: 'worker-fresh',
      leaseUntil: 1760000030000,
      attemptId: 'attempt-fresh',
    });

    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]).toMatchObject({
      status: 'PROCESSING',
      leaseOwner: 'worker-fresh',
      leaseUntil: 1760000030000,
      attemptId: 'attempt-fresh',
    });
  });

  it('does not reuse a non-expired processing task when the same record is queued again', async () => {
    const store = createDexieSyncQueueStore();
    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-22', 'v1'));
    await store.claimReadyPending(1760000000000, 1, null, {
      leaseOwner: 'worker-a',
      leaseUntil: 1760000030000,
      attemptId: 'attempt-a',
    });

    const result = await queueDailyRecordSyncTaskWithLocalRecord(makeRecord('2025-01-22', 'v2'), {
      contexts: ['clinical'],
      origin: 'partial_update_retry',
    });

    const tasks = await hospitalDB.syncQueue.orderBy('timestamp').toArray();
    expect(result.mode).toBe('created');
    expect(tasks).toHaveLength(2);
    expect(tasks.map(task => task.status)).toEqual(['PROCESSING', 'PENDING']);
    expect((tasks[1].payload as DailyRecord).lastUpdated).toBe('v2');
  });

  it('does not let a stale worker completion delete a newer requeued mutation', async () => {
    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-23', 'v1'));
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    vi.mocked(setDoc).mockImplementationOnce(async () => {
      await queueDailyRecordSyncTaskWithLocalRecord(makeRecord('2025-01-23', 'v2'), {
        contexts: ['clinical'],
        origin: 'partial_update_retry',
      });
    });

    await processSyncQueue();

    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      status: 'PENDING',
      leaseOwner: undefined,
      attemptId: undefined,
    });
    expect((tasks[0].payload as DailyRecord).lastUpdated).toBe('v2');
  });

  it('records telemetry when a worker completion no longer owns the claimed task', async () => {
    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-24', 'v1'));
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    vi.mocked(setDoc).mockImplementationOnce(async () => {
      const [processingTask] = await hospitalDB.syncQueue
        .where('status')
        .equals('PROCESSING')
        .toArray();
      if (!processingTask?.id) {
        throw new Error('Expected a processing task to be claimed before transport completes.');
      }
      await hospitalDB.syncQueue.update(processingTask.id, { leaseUntil: 1 });
      await createDexieSyncQueueStore().claimReadyPending(FRESH_WORKER_NOW_MS, 1, null, {
        leaseOwner: 'worker-fresh',
        leaseUntil: FRESH_WORKER_LEASE_UNTIL_MS,
        attemptId: 'attempt-fresh',
      });
    });

    await processSyncQueue();

    const [task] = await hospitalDB.syncQueue.toArray();
    expect(task).toMatchObject({
      status: 'PROCESSING',
      leaseOwner: 'worker-fresh',
      attemptId: 'attempt-fresh',
    });
    expect(recordOperationalTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'sync',
        operation: 'sync_queue_stale_claim_noop',
        status: 'degraded',
        runtimeState: 'recoverable',
        context: expect.objectContaining({
          action: 'delete',
          type: 'UPDATE_DAILY_RECORD',
          key: 'daily:2025-01-24',
        }),
      })
    );
  });

  it('processes an expired older lease before a newer pending mutation for the same record key', async () => {
    await hospitalDB.syncQueue.add({
      opId: 'old-expired',
      type: 'UPDATE_DAILY_RECORD',
      payload: makeRecord('2025-01-25', 'v1'),
      timestamp: 1760000000000,
      retryCount: 0,
      status: 'PROCESSING',
      key: 'daily:2025-01-25',
      leaseOwner: 'stale-worker',
      leaseUntil: 1760000000000 - 1,
      attemptId: 'stale-attempt',
    });
    await hospitalDB.syncQueue.add({
      opId: 'new-pending',
      type: 'UPDATE_DAILY_RECORD',
      payload: makeRecord('2025-01-25', 'v2'),
      timestamp: 1760000000001,
      retryCount: 0,
      status: 'PENDING',
      key: 'daily:2025-01-25',
    });
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });

    await processSyncQueue();

    expect(vi.mocked(setDoc).mock.calls.map(call => (call[1] as DailyRecord).lastUpdated)).toEqual([
      'v1',
      'v2',
    ]);
    await expect(hospitalDB.syncQueue.toArray()).resolves.toHaveLength(0);
  });
});
