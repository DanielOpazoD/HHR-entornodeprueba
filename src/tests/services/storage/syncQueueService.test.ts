import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexedDBService';
import { logError } from '@/services/utils/errorService';

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

vi.mock('@/services/utils/errorService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/utils/errorService')>();
  return {
    ...actual,
    logError: vi.fn(),
  };
});

import { getDoc, setDoc } from 'firebase/firestore';
import {
  getSyncQueueDomainMetrics,
  queueSyncTask,
  processSyncQueue,
  getSyncQueueStats,
  getSyncQueueTelemetry,
  listRecentSyncQueueOperations,
} from '@/services/storage/sync';
import { resetSyncMutationIdentityForTests } from '@/services/storage/sync/syncMutationIdentity';
import type { DailyRecord } from '@/types/domain/dailyRecord';

describe('storage/sync public entrypoint', () => {
  const FIXED_NOW = 1760000000000;

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

  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
    resetSyncMutationIdentityForTests();
    vi.clearAllMocks();
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => false,
      data: () => undefined,
    } as Awaited<ReturnType<typeof getDoc>>);
    vi.mocked(setDoc).mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  });

  it('deduplicates tasks by record date', async () => {
    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-01', 'v1'));
    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-01', 'v2'));

    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    const payload = tasks[0].payload as DailyRecord;
    expect(payload.lastUpdated).toBe('v2');
  });

  it('stores an extensible sync contract for daily record tasks', async () => {
    const record = makeRecord('2025-01-12', '2025-01-12T10:00:00.000Z');
    record.beds.R1 = {
      bedId: 'R1',
      patientName: 'Paciente Sync',
      rut: '11.111.111-1',
      admissionDate: '2025-01-10',
      admissionTime: '14:30',
      isBlocked: false,
    } as DailyRecord['beds'][string];

    await queueSyncTask('UPDATE_DAILY_RECORD', record, {
      contexts: ['clinical'],
      origin: 'partial_update_retry',
      syncContract: {
        expectedVersion: '2025-01-12T09:00:00.000Z',
        changedPaths: ['beds.R1.pathology'],
      },
    });

    const [task] = await hospitalDB.syncQueue.toArray();

    expect(task.syncContract).toEqual(
      expect.objectContaining({
        expectedVersion: '2025-01-12T09:00:00.000Z',
        recordRevision: '2025-01-12T10:00:00.000Z',
        changedPaths: ['beds.R1.pathology'],
        clinicalEpisodeKeys: ['11.111.111-1__2025-01-10__14:30'],
        mutationId: expect.stringMatching(/^mutation_/),
        clientId: expect.stringMatching(/^client_/),
        tabId: expect.stringMatching(/^tab_/),
      })
    );
  });

  it('prefers persisted clinicalEpisodeId in sync contract episode keys', async () => {
    const record = makeRecord('2025-01-12', '2025-01-12T10:00:00.000Z');
    record.beds.R1 = {
      bedId: 'R1',
      clinicalEpisodeId: 'episode-r1-canonical',
      patientName: 'Paciente Sync',
      rut: '11.111.111-1',
      admissionDate: '2025-01-10',
      admissionTime: '14:30',
      isBlocked: false,
    } as DailyRecord['beds'][string];

    await queueSyncTask('UPDATE_DAILY_RECORD', record);

    const [task] = await hospitalDB.syncQueue.toArray();

    expect(task.syncContract?.clinicalEpisodeKeys).toEqual(['episode-r1-canonical']);
  });

  it('backs off and retries when sync fails', async () => {
    vi.mocked(setDoc).mockRejectedValueOnce(new Error('Network down'));

    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-02', 'v1'), {
      contexts: ['clinical'],
      origin: 'full_save_retry',
    });
    await processSyncQueue();

    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('PENDING');
    expect(tasks[0].retryCount).toBe(1);
    expect(tasks[0].nextAttemptAt || 0).toBeGreaterThan(FIXED_NOW - 1000);
  });

  it('reports queue stats', async () => {
    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-03', 'v1'));
    const stats = await getSyncQueueStats();
    expect(stats.pending).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.conflict).toBe(0);
  });

  it('reports telemetry including retrying and oldest pending age', async () => {
    vi.mocked(setDoc).mockRejectedValueOnce(new Error('Network down'));
    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-06', 'v1'));
    await processSyncQueue();

    const telemetry = await getSyncQueueTelemetry();
    expect(telemetry.pending).toBe(1);
    expect(telemetry.retrying).toBe(1);
    expect(telemetry.oldestPendingAgeMs).toBeGreaterThanOrEqual(0);
    expect(telemetry.batchSize).toBeGreaterThan(0);
    expect(telemetry.retryingBudgetState).toBe('warning');
    expect(telemetry.runtimeState).toBe('degraded');
  });

  it('rejects new unique tasks when the queue reaches the hard pending cap but still reuses existing keys', async () => {
    for (let i = 0; i < 192; i++) {
      await queueSyncTask(
        'UPDATE_DAILY_RECORD',
        makeRecord(`2025-02-${String(i).padStart(2, '0')}`, `v${i}`)
      );
    }

    const rejected = await queueSyncTask(
      'UPDATE_DAILY_RECORD',
      makeRecord('2025-09-01', 'overflow')
    );
    expect(rejected).toMatchObject({
      accepted: false,
      mode: 'rejected_backpressure',
      pendingTasks: 192,
      maxPendingTasks: 192,
    });

    const reused = await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-02-00', 'v-reused'));
    expect(reused.accepted).toBe(true);
    expect(reused.mode).toBe('reused');
  });

  it('marks telemetry as blocked when a pending task exceeds the critical queue age budget', async () => {
    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-11', 'v1'));
    await hospitalDB.syncQueue
      .where('status')
      .equals('PENDING')
      .modify(task => {
        task.timestamp = FIXED_NOW - 901_000;
      });

    const telemetry = await getSyncQueueTelemetry();
    expect(telemetry.oldestPendingBudgetState).toBe('critical');
    expect(telemetry.runtimeState).toBe('blocked');
  });

  it('marks task as failed without retry for non-retryable errors', async () => {
    vi.mocked(setDoc).mockRejectedValueOnce({
      code: 'permission-denied',
      message: 'Missing or insufficient permissions',
    });

    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-04', 'v1'));
    await processSyncQueue();

    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('FAILED');
    expect(tasks[0].retryCount).toBe(0);
    expect(tasks[0].lastErrorCode).toBe('permission-denied');
    expect(tasks[0].lastErrorCategory).toBe('authorization');

    const [operation] = await listRecentSyncQueueOperations(1);
    expect(operation).toMatchObject({
      status: 'FAILED',
      lastErrorCode: 'permission-denied',
      lastErrorCategory: 'authorization',
      lastErrorAction: 'Revisar permisos/reglas y sesión del usuario.',
    });
    expect(operation.lastErrorAt).toEqual(expect.any(Number));
  });

  it('marks task as conflict when remote concurrency conflict occurs', async () => {
    const conflictError = new Error('Concurrency conflict');
    conflictError.name = 'ConcurrencyError';
    vi.mocked(setDoc).mockRejectedValueOnce(conflictError);

    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-05', 'v1'), {
      contexts: ['handoff'],
      origin: 'partial_update_retry',
    });
    await processSyncQueue();

    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('CONFLICT');
    expect(tasks[0].lastErrorCategory).toBe('conflict');
    expect(tasks[0].lastErrorAction).toContain('handoff');
  });

  it('revalidates stale daily record tasks against Firebase before writing', async () => {
    const local = makeRecord('2025-01-13', '2025-01-13T10:10:00.000Z');
    local.beds.R1 = {
      bedId: 'R1',
      patientName: 'Paciente Sync',
      rut: '11.111.111-1',
      age: '40a',
      pathology: 'Diagnostico local stale',
      specialty: 'Medicina',
      status: 'Estable',
      admissionDate: '2025-01-13',
      isBlocked: false,
      bedMode: 'Cuna',
      hasCompanionCrib: false,
      hasWristband: true,
      devices: [],
      surgicalComplication: false,
      isUPC: false,
    } as DailyRecord['beds'][string];

    const remote = makeRecord('2025-01-13', '2025-01-13T10:20:00.000Z');
    remote.beds.R1 = {
      ...local.beds.R1,
      pathology: 'Diagnostico Firebase vigente',
      bedMode: 'Cama',
    };

    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => remote as unknown as Record<string, unknown>,
    } as Awaited<ReturnType<typeof getDoc>>);

    await queueSyncTask('UPDATE_DAILY_RECORD', local, {
      contexts: ['clinical'],
      origin: 'partial_update_retry',
      syncContract: {
        expectedVersion: '2025-01-13T10:00:00.000Z',
        changedPaths: ['beds.R1.pathology'],
      },
    });

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await processSyncQueue();

    expect(setDoc).toHaveBeenCalledTimes(1);
    const writtenRecord = vi.mocked(setDoc).mock.calls[0][1] as DailyRecord;
    expect(writtenRecord.beds.R1.pathology).toBe('Diagnostico local stale');
    expect(writtenRecord.beds.R1.bedMode).toBe('Cama');
    expect(writtenRecord.lastUpdated).toBe('2025-01-13T10:20:00.000Z');
    await expect(hospitalDB.syncQueue.toArray()).resolves.toHaveLength(0);
  });

  it('writes non-stale daily record tasks without remote remerge', async () => {
    const local = makeRecord('2025-01-14', '2025-01-14T10:10:00.000Z');
    local.beds.R1 = {
      bedId: 'R1',
      patientName: 'Paciente Local Vigente',
      rut: '22.222.222-2',
      age: '50a',
      pathology: 'Diagnostico local vigente',
      specialty: 'Medicina',
      status: 'Estable',
      admissionDate: '2025-01-14',
      isBlocked: false,
      bedMode: 'Cuna',
      hasCompanionCrib: false,
      hasWristband: true,
      devices: [],
      surgicalComplication: false,
      isUPC: false,
    } as DailyRecord['beds'][string];

    const remote = makeRecord('2025-01-14', '2025-01-14T10:00:00.000Z');
    remote.beds.R1 = {
      ...local.beds.R1,
      pathology: 'Diagnostico remoto anterior',
      bedMode: 'Cama',
    };

    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => remote as unknown as Record<string, unknown>,
    } as Awaited<ReturnType<typeof getDoc>>);

    await queueSyncTask('UPDATE_DAILY_RECORD', local, {
      contexts: ['clinical'],
      origin: 'partial_update_retry',
      syncContract: {
        expectedVersion: remote.lastUpdated,
        changedPaths: ['beds.R1.pathology'],
      },
    });

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await processSyncQueue();

    expect(setDoc).toHaveBeenCalledTimes(1);
    const writtenRecord = vi.mocked(setDoc).mock.calls[0][1] as DailyRecord;
    expect(writtenRecord.beds.R1.pathology).toBe('Diagnostico local vigente');
    expect(writtenRecord.beds.R1.bedMode).toBe('Cuna');
    expect(writtenRecord.lastUpdated).toBe(local.lastUpdated);
    await expect(hospitalDB.syncQueue.toArray()).resolves.toHaveLength(0);
  });

  it('keeps stale revalidated tasks in conflict when clinical consistency is blocked', async () => {
    const local = makeRecord('2025-01-15', '2025-01-15T10:10:00.000Z');
    const duplicatedPatient = {
      bedId: 'R1',
      patientName: 'Paciente Duplicado',
      rut: '33.333.333-3',
      age: '60a',
      pathology: 'Diagnostico local',
      specialty: 'Medicina',
      status: 'Estable',
      admissionDate: '2025-01-15',
      isBlocked: false,
      bedMode: 'Cama',
      hasCompanionCrib: false,
      hasWristband: true,
      devices: [],
      surgicalComplication: false,
      isUPC: false,
    } as DailyRecord['beds'][string];
    local.beds.R1 = duplicatedPatient;
    local.beds.R2 = { ...duplicatedPatient, bedId: 'R2' };

    const remote = makeRecord('2025-01-15', '2025-01-15T10:20:00.000Z');
    remote.beds.R1 = { ...duplicatedPatient, patientName: '' };
    remote.beds.R2 = { ...duplicatedPatient, patientName: '' };

    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      data: () => remote as unknown as Record<string, unknown>,
    } as Awaited<ReturnType<typeof getDoc>>);

    await queueSyncTask('UPDATE_DAILY_RECORD', local, {
      contexts: ['clinical'],
      origin: 'partial_update_retry',
      syncContract: {
        expectedVersion: '2025-01-15T10:00:00.000Z',
        changedPaths: ['beds.R1', 'beds.R2'],
      },
    });

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await processSyncQueue();

    expect(setDoc).not.toHaveBeenCalled();
    const [task] = await hospitalDB.syncQueue.toArray();
    expect(task.status).toBe('CONFLICT');
    expect(task.lastErrorCategory).toBe('conflict');
    expect(task.syncContract?.changedPaths).toEqual(['beds.R1', 'beds.R2']);
  });

  it('does not process tasks scheduled for a future retry window', async () => {
    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-07', 'v1'));
    await hospitalDB.syncQueue
      .where('status')
      .equals('PENDING')
      .modify(task => {
        task.nextAttemptAt = 2_000_000_000_000;
      });

    await processSyncQueue();

    expect(vi.mocked(setDoc)).not.toHaveBeenCalled();
    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('PENDING');
  });

  it('marks task as failed after exhausting max retries', async () => {
    vi.mocked(setDoc).mockRejectedValue(new Error('Network down'));

    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-08', 'v1'), {
      contexts: ['clinical'],
      origin: 'full_save_retry',
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      await hospitalDB.syncQueue
        .where('status')
        .equals('PENDING')
        .modify(task => {
          task.nextAttemptAt = 0;
        });
      await processSyncQueue();
    }

    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('FAILED');
    expect(tasks[0].retryCount).toBe(5);
    expect(vi.mocked(logError)).toHaveBeenCalledWith(
      'Sync task permanently failed',
      expect.any(Error),
      expect.objectContaining({
        type: 'UPDATE_DAILY_RECORD',
        retryCount: 5,
      })
    );
  });

  it('uses domain metrics and recent operations to expose sync context', async () => {
    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-09', 'v1'), {
      contexts: ['staffing', 'handoff'],
      origin: 'partial_update_retry',
    });

    const metrics = await getSyncQueueDomainMetrics();
    const operations = await listRecentSyncQueueOperations(5);

    expect(metrics.byContext.staffing.pending).toBe(1);
    expect(metrics.byContext.handoff.pending).toBe(1);
    expect(metrics.byOrigin.partial_update_retry).toBe(1);
    expect(operations[0]?.contexts).toEqual(['staffing', 'handoff']);
    expect(operations[0]?.recoveryPolicy).toBe('staffing_handoff_priority');
  });

  it('applies a lower retry budget to metadata-only tasks', async () => {
    vi.mocked(setDoc).mockRejectedValue(new Error('Network down'));

    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-01-10', 'v1'), {
      contexts: ['metadata'],
      origin: 'partial_update_retry',
    });

    for (let attempt = 0; attempt < 3; attempt++) {
      await hospitalDB.syncQueue
        .where('status')
        .equals('PENDING')
        .modify(task => {
          task.nextAttemptAt = 0;
        });
      await processSyncQueue();
    }

    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('FAILED');
    expect(tasks[0].retryCount).toBe(3);
    expect(tasks[0].recoveryPolicy).toBe('metadata_remote_priority');
  });
});
