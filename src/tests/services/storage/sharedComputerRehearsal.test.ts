import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createBrowserSyncRuntime } from '@/services/storage/sync/browserSyncRuntime';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import { requeueQuarantinedTask } from '@/services/storage/sync/dexieSyncQueueQuarantine';
import {
  getDailyRecordReviewBackup,
  reviewBlockedDailyRecordTask,
} from '@/services/storage/sync/dailyRecordTaskRetirement';
import { resetMedicalHandoffDraftMemoryForTests } from '@/services/storage/medicalHandoffDraftStorage';
import { persistOperationalTelemetryEvents } from '@/services/observability/operationalTelemetryStore';
import { listQuarantinedOperations } from '@/features/rayen-import/components/localSyncPresentation';
import { DataFactory } from '@/tests/factories/DataFactory';
import { applyClinicalEnrichmentBatch } from '@/features/rayen-import/hooks/applyClinicalEnrichmentBatch';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { SyncTransportPort } from '@/services/storage/sync/syncQueuePorts';

// Network delivery is controlled; storage, ownership, worker and recovery are production code.
vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: { getCurrentUser: () => ({ uid: 'hhrn_synthetic-a' }) },
}));
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

const ownerA = 'user:hhrn_synthetic-a';
const ownerB = 'user:hhrn_synthetic-b';
const day = DataFactory.createMockDailyRecord('2026-11-01', {
  beds: {},
  nursesDayShift: ['SYNTHETIC UNSENT A'],
  lastUpdated: '2026-11-01T15:00:00.000Z',
});
const task = (): SyncTask => ({
  opId: 'synthetic-shared-computer-edit',
  ownerKey: ownerA,
  type: 'UPDATE_DAILY_RECORD',
  key: `daily:${day.date}`,
  payload: day,
  timestamp: 1,
  retryCount: 0,
  status: 'PENDING',
  syncContract: { mutationId: 'synthetic-shared-computer-edit', changedPaths: ['nursesDayShift'] },
});
const engine = (run: SyncTransportPort['run'] = vi.fn(async () => undefined)) =>
  createSyncQueueEngine({
    store: createDexieSyncQueueStore(),
    runtime: createBrowserSyncRuntime(),
    transport: { run },
    batchSize: 10,
    maxPendingTasks: 100,
    maxRetries: 3,
    baseRetryDelayMs: 10,
    maxRetryDelayMs: 100,
  });

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  resetMedicalHandoffDraftMemoryForTests();
  persistOperationalTelemetryEvents([]);
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.errorLogs.clear();
  await reconcileAuthorizedSessionOwner(ownerA);
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.errorLogs.clear();
  localStorage.clear();
  sessionStorage.clear();
  setSessionGeneration(null);
  resetMedicalHandoffDraftMemoryForTests();
  persistOperationalTelemetryEvents([]);
});

describe('same Chrome, sequential individual HHR accounts (synthetic)', () => {
  it('hides A pending work from B but gives returning A an actionable review and exact backup', async () => {
    await hospitalDB.dailyRecords.put(day);
    const id = Number(await hospitalDB.syncQueue.add(task()));
    await clearSessionScopedClientState('manual');
    await reconcileAuthorizedSessionOwner(ownerB);
    const worker = engine();

    expect(await hospitalDB.dailyRecords.count()).toBe(0);
    expect(await worker.getTelemetry()).toMatchObject({ pending: 0, failed: 0, conflict: 0 });
    expect(await worker.listRecentOperations(20)).toEqual([]);
    expect(await reviewBlockedDailyRecordTask(id)).toBeNull();

    await clearSessionScopedClientState('manual');
    await reconcileAuthorizedSessionOwner(ownerA);
    expect(await worker.getTelemetry()).toMatchObject({ pending: 0, failed: 1 });
    expect(listQuarantinedOperations(await worker.listRecentOperations(20))).toEqual([
      expect.objectContaining({ id, recovery: 'review_base', code: 'session_owner_logged_out' }),
    ]);
    expect(await requeueQuarantinedTask(id, ownerA)).toBe(false);
    const review = await reviewBlockedDailyRecordTask(id);
    if (!review) throw new Error('Expected A to recover the retained send');
    const backup = await getDailyRecordReviewBackup(review);
    expect(backup && JSON.parse(backup)).toMatchObject({
      remotelyConfirmed: false,
      task: { payload: day, ownerKey: ownerA, projectionReleased: true },
    });
  });

  it('does not adopt an old in-flight ACK into B even if the remote request commits after logout', async () => {
    await hospitalDB.dailyRecords.put(day);
    const id = Number(await hospitalDB.syncQueue.add(task()));
    const confirmed = { ...day, lastUpdated: '2026-11-01T15:01:00.000Z' };
    let remoteCommitted = false;
    const run = vi.fn(async () => {
      await clearSessionScopedClientState('manual');
      await reconcileAuthorizedSessionOwner(ownerB);
      remoteCommitted = true;
      return { authoritativeRecord: confirmed };
    });

    await engine(run).processQueue();

    expect(run).toHaveBeenCalledOnce();
    expect(remoteCommitted).toBe(true); // This models an already dispatched request, not an emulator write.
    expect(getStoredSessionOwnerKey()).toBe(ownerB);
    expect(await hospitalDB.dailyRecords.get(day.date)).toBeUndefined();
    expect(await hospitalDB.syncQueue.get(id)).toMatchObject({
      ownerKey: ownerA,
      status: 'FAILED',
      payload: day,
      projectionReleased: true,
    });
  });

  it('uses the same durable review fence when inactivity closes A automatically', async () => {
    await hospitalDB.dailyRecords.put(day);
    const id = Number(await hospitalDB.syncQueue.add(task()));
    await clearSessionScopedClientState('automatic');
    await reconcileAuthorizedSessionOwner(ownerB);
    expect(await engine().listRecentOperations(20)).toEqual([]);
    expect(await hospitalDB.syncQueue.get(id)).toMatchObject({
      ownerKey: ownerA,
      status: 'FAILED',
      payload: day,
      lastErrorCode: 'session_owner_logged_out',
    });
  });

  describe('clinical batches stop when the HHR session is replaced', () => {
    it.each(['manual', 'automatic'] as const)(
      'stops the old run after %s logout during authoritative refresh',
      async reason => {
        const record = {
          ...day,
          beds: {
            R1: DataFactory.createMockPatient('R1', {
              clinicalEpisodeId: 'synthetic-episode-a',
              patientName: 'SYNTHETIC PATIENT',
            }),
          },
        };
        const invokedAs: Array<string | null> = [];
        const result = applyClinicalEnrichmentBatch({
          mode: 'enforced',
          record,
          runId: 'synthetic-run-owned-by-a',
          operations: [
            {
              target: {
                bedId: 'R1',
                clinicalEpisodeId: 'synthetic-episode-a',
                censusDate: record.date,
              },
              patch: { 'beds.R1.evaluationScores': { braden: { total: 17 } } },
            },
          ],
          refreshRecord: async () => {
            await clearSessionScopedClientState(reason);
            await reconcileAuthorizedSessionOwner(ownerB);
            return record;
          },
          refreshCommittedRecord: async () => undefined,
          invoke: async payload => {
            invokedAs.push(getStoredSessionOwnerKey());
            expect(payload.runId).toBe('synthetic-run-owned-by-a');
            return {
              success: true,
              authorityStatus: 'ok',
              date: payload.date,
              mode: payload.mode,
              targetCount: 1,
              fieldCount: 1,
              resultParity: 'matched',
            };
          },
        });
        await expect(result).rejects.toThrow('La sesión cambió.');
        expect(invokedAs).toEqual([]);
      }
    );
  });
});
