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
    getRecordDocRef: vi.fn(() => ({ id: 'quarantine-test-doc-ref' })),
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
  discardQuarantinedSyncTask,
  processSyncQueue,
  queueDailyRecordSyncTaskWithLocalRecord,
  queueSyncTask,
  retryQuarantinedSyncTask,
} from '@/services/storage/sync';
import { resetSyncMutationIdentityForTests } from '@/services/storage/sync/syncMutationIdentity';
import type { DailyRecord } from '@/types/domain/dailyRecord';

/**
 * Cuarentena de píldoras venenosas y su recuperación: una tarea FAILED/CONFLICT
 * no reintenta sola, pero (1) una edición fresca del mismo registro la
 * SUPERSEDE (revive como PENDING con el payload nuevo, sin duplicar la key ni
 * bloquear la adopción autoritativa), y (2) el usuario puede reintentarla o
 * descartarla explícitamente desde el indicador de la barra.
 */
describe('storage/sync cuarentena y recuperación', () => {
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

  const failNextWriteWith = (error: unknown): void => {
    vi.mocked(setDoc).mockRejectedValueOnce(error);
  };

  const quarantineDailyRecordTask = async (date: string, error: unknown): Promise<void> => {
    failNextWriteWith(error);
    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord(date, 'v1'));
    await processSyncQueue();
  };

  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
    resetSyncMutationIdentityForTests();
    vi.clearAllMocks();
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => false,
      data: () => undefined,
    } as Awaited<ReturnType<typeof getDoc>>);
    vi.mocked(setDoc).mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  });

  it('una edición fresca supersede la tarea FAILED en vez de duplicarla', async () => {
    await quarantineDailyRecordTask('2025-02-01', {
      code: 'permission-denied',
      message: 'Missing or insufficient permissions',
    });
    expect((await hospitalDB.syncQueue.toArray())[0].status).toBe('FAILED');

    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-02-01', 'v2'));

    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('PENDING');
    expect(tasks[0].retryCount).toBe(0);
    expect(tasks[0].lastErrorCode).toBeUndefined();
    expect((tasks[0].payload as DailyRecord).lastUpdated).toBe('v2');
  });

  it('una edición fresca también supersede la tarea CONFLICT', async () => {
    const conflictError = new Error('Concurrency conflict');
    conflictError.name = 'ConcurrencyError';
    await quarantineDailyRecordTask('2025-02-02', conflictError);
    expect((await hospitalDB.syncQueue.toArray())[0].status).toBe('CONFLICT');

    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-02-02', 'v2'));

    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('PENDING');
    expect((tasks[0].payload as DailyRecord).lastUpdated).toBe('v2');
  });

  it('el guardado transaccional (registro + tarea) reutiliza la tarea en cuarentena', async () => {
    await quarantineDailyRecordTask('2025-02-03', {
      code: 'permission-denied',
      message: 'Missing or insufficient permissions',
    });

    const result = await queueDailyRecordSyncTaskWithLocalRecord(makeRecord('2025-02-03', 'v2'));

    expect(result).toMatchObject({ accepted: true, mode: 'reused' });
    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe('PENDING');
    expect((tasks[0].payload as DailyRecord).lastUpdated).toBe('v2');
  });

  it('retryQuarantinedSyncTask revive la tarea limpia; sobre una PENDING no hace nada', async () => {
    await quarantineDailyRecordTask('2025-02-04', {
      code: 'permission-denied',
      message: 'Missing or insufficient permissions',
    });
    const [failedTask] = await hospitalDB.syncQueue.toArray();

    await expect(retryQuarantinedSyncTask(failedTask.id!)).resolves.toBe(true);

    const [revived] = await hospitalDB.syncQueue.toArray();
    expect(revived.status).toBe('PENDING');
    expect(revived.retryCount).toBe(0);
    expect(revived.error).toBeUndefined();
    expect(revived.lastErrorCategory).toBeUndefined();

    await expect(retryQuarantinedSyncTask(failedTask.id!)).resolves.toBe(false);
    expect((await hospitalDB.syncQueue.toArray())[0].status).toBe('PENDING');
  });

  it('discardQuarantinedSyncTask elimina solo tareas en cuarentena', async () => {
    await queueSyncTask('UPDATE_DAILY_RECORD', makeRecord('2025-02-05', 'v1'));
    const [pendingTask] = await hospitalDB.syncQueue.toArray();

    await expect(discardQuarantinedSyncTask(pendingTask.id!)).resolves.toBe(false);
    expect(await hospitalDB.syncQueue.count()).toBe(1);

    failNextWriteWith({ code: 'permission-denied', message: 'denied' });
    await processSyncQueue();
    await expect(discardQuarantinedSyncTask(pendingTask.id!)).resolves.toBe(true);
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });

  it('un no-retryable queda registrado como fallo permanente desde el primer intento', async () => {
    await quarantineDailyRecordTask('2025-02-06', {
      code: 'permission-denied',
      message: 'Missing or insufficient permissions',
    });

    expect(vi.mocked(logError)).toHaveBeenCalledWith(
      'Sync task permanently failed',
      undefined,
      expect.objectContaining({ type: 'UPDATE_DAILY_RECORD', retryCount: 0 })
    );
  });
});
