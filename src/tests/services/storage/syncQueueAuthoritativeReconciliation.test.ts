import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexedDBService';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { adoptAuthoritativeRecord } from '@/services/repositories/dailyRecordRepositorySyncService';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';
import {
  queueDailyRecordSyncTaskWithLocalRecord,
  getSyncQueueStats,
} from '@/services/storage/sync';
import { resetSyncMutationIdentityForTests } from '@/services/storage/sync/syncMutationIdentity';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

const DATE = '2026-01-10';
const LOCAL_REVISION = `${DATE}T12:00:00.000Z`;
const REMOTE_REVISION = `${DATE}T12:00:01.000Z`;

const setup = async (status: SyncTask['status'], changedPaths = ['nursesDayShift']) => {
  const local = prepareDailyRecordForPersistence(
    DataFactory.createMockDailyRecord(DATE, {
      lastUpdated: LOCAL_REVISION,
      nursesDayShift: ['Enfermera confirmada'],
      handoffNovedadesNightShift: 'Nota local conservada',
      beds: {
        R1: DataFactory.createMockPatient('R1', {
          clinicalEpisodeId: 'synthetic-episode',
          cudyr: DataFactory.createMockCudyr({ changeClothes: 2, surveillance: 3 }),
        }),
      },
    }),
    DATE
  );
  await queueDailyRecordSyncTaskWithLocalRecord(local, {
    syncContract: { changedPaths, expectedVersion: `${DATE}T11:59:59.000Z` },
  });
  const [queued] = await hospitalDB.syncQueue.toArray();
  await hospitalDB.syncQueue.update(queued.id!, {
    status,
    retryCount: 4,
    lastErrorCode: 'validation-failed',
    lastErrorCategory: 'validation',
  });
  const remote = { ...structuredClone(local), lastUpdated: REMOTE_REVISION };
  return { local, remote, task: (await hospitalDB.syncQueue.get(queued.id!))! };
};

describe('authoritative reconciliation of quarantined daily writes', () => {
  beforeEach(async () => {
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    localStorage.clear();
    resetSyncMutationIdentityForTests();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(LOCAL_REVISION));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(['FAILED', 'CONFLICT'] as const)(
    'removes %s only when a confirmed command covers every pending path, durably',
    async status => {
      const { local, remote } = await setup(status);
      expect((await hospitalDB.syncQueue.toArray())[0].status).toBe(status);
      await expect(
        adoptAuthoritativeRecord(remote, { nursesDayShift: remote.nursesDayShift })
      ).resolves.toMatchObject({ lastUpdated: REMOTE_REVISION });

      // Fresh storage reads model reloading the projection and its pending indicator.
      expect(await createDexieSyncQueueStore().listAll(null)).toEqual([]);
      expect(await getSyncQueueStats()).toEqual({ pending: 0, failed: 0, conflict: 0 });
      const persisted = await hospitalDB.dailyRecords.get(DATE);
      expect(persisted?.beds.R1).toEqual(local.beds.R1);
      expect(persisted?.lastUpdated).toBe(REMOTE_REVISION);
      expect(persisted?.handoffNovedadesNightShift).toBe(local.handoffNovedadesNightShift);
      await adoptAuthoritativeRecord(remote, { nursesDayShift: remote.nursesDayShift });
      expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(persisted);
      expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
    }
  );

  it.each(['FAILED', 'CONFLICT'] as const)(
    'preserves %s and all local data when a genuine edit remains unconfirmed',
    async status => {
      const { local, remote, task } = await setup(status, [
        'nursesDayShift',
        'handoffNovedadesNightShift',
      ]);
      remote.handoffNovedadesNightShift = 'Nota remota anterior';
      await expect(
        adoptAuthoritativeRecord(remote, { nursesDayShift: remote.nursesDayShift })
      ).rejects.toThrow('sincronización local pendiente');
      expect(await hospitalDB.syncQueue.toArray()).toEqual([task]);
      expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(local);
    }
  );

  it.each(['PROCESSING', 'RETIRED'] as const)('never reconciles a %s task', async status => {
    const { local, remote, task } = await setup(status);
    await expect(
      adoptAuthoritativeRecord(remote, { nursesDayShift: remote.nursesDayShift })
    ).rejects.toThrow('sincronización local pendiente');
    expect(await hospitalDB.syncQueue.toArray()).toEqual([task]);
    expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(local);
  });

  it('adopts the confirmed record after an explicitly reviewed withdrawal while preserving its backup', async () => {
    const { remote, task } = await setup('RETIRED');
    const retirement: SyncTask['retirement'] = {
      reason: 'manual_discard',
      retiredAt: new Date().toISOString(),
      previousStatus: 'FAILED',
    };
    await hospitalDB.syncQueue.update(task.id!, { retirement });
    await expect(
      adoptAuthoritativeRecord(remote, { nursesDayShift: remote.nursesDayShift })
    ).resolves.toMatchObject({ lastUpdated: REMOTE_REVISION });
    expect(await hospitalDB.syncQueue.toArray()).toEqual([{ ...task, retirement }]);
    expect((await hospitalDB.dailyRecords.get(DATE))?.lastUpdated).toBe(REMOTE_REVISION);
  });

  it('preserves a newer local revision while reconciling an older failed payload', async () => {
    const { local, remote, task } = await setup('FAILED');
    const newer = { ...local, lastUpdated: `${DATE}T12:00:02.000Z` };
    await hospitalDB.dailyRecords.put(newer);
    await expect(
      adoptAuthoritativeRecord(remote, { nursesDayShift: remote.nursesDayShift })
    ).rejects.toThrow('sincronización local pendiente');
    expect(await hospitalDB.syncQueue.toArray()).toEqual([task]);
    expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(newer);
  });

  it('does not infer ownership for legacy whole-record writes', async () => {
    const { local, remote, task } = await setup('FAILED', ['*']);
    await expect(
      adoptAuthoritativeRecord(remote, { nursesDayShift: remote.nursesDayShift })
    ).rejects.toThrow('sincronización local pendiente');
    expect(await hospitalDB.syncQueue.toArray()).toEqual([task]);
    expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(local);
  });

  it('preserves ambiguous multiple writes for the same day', async () => {
    const { local, remote, task } = await setup('FAILED');
    const { id: _id, ...other } = task;
    await hospitalDB.syncQueue.add({ ...other, opId: 'another-pending-write' });
    const before = await hospitalDB.syncQueue.toArray();
    await expect(
      adoptAuthoritativeRecord(remote, { nursesDayShift: remote.nursesDayShift })
    ).rejects.toThrow('sincronización local pendiente');
    expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
    expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(local);
  });

  it('rolls back adoption if removing the confirmed queue task fails', async () => {
    const { local, remote, task } = await setup('FAILED');
    vi.spyOn(hospitalDB.syncQueue, 'delete').mockRejectedValueOnce(
      new Error('Storage unavailable')
    );
    await expect(
      adoptAuthoritativeRecord(remote, { nursesDayShift: remote.nursesDayShift })
    ).rejects.toThrow('sincronización local pendiente');
    expect(await hospitalDB.syncQueue.toArray()).toEqual([task]);
    expect(await hospitalDB.dailyRecords.get(DATE)).toEqual(local);
  });

  it.each(['FAILED', 'CONFLICT'] as const)(
    'keeps verified clinical carryover from authority when clearing %s',
    async status => {
      const { local, remote } = await setup(status);
      local.beds.R1.devices = ['CUP'];
      local.beds.R1.clinicalCarryover = {
        sourceDate: '2026-01-09',
        clinicalEpisodeId: 'synthetic-episode',
        vitalsPending: true,
        devicesPending: true,
      };
      await hospitalDB.dailyRecords.put(local);
      remote.beds.R1.devices = [];
      remote.beds.R1.deviceDetails = { CUP: { installationDate: '2026-01-08', removalDate: DATE } };
      remote.beds.R1.clinicalCarryover = {
        ...local.beds.R1.clinicalCarryover,
        vitalsPending: false,
        devicesPending: false,
      };
      await adoptAuthoritativeRecord(remote, { nursesDayShift: remote.nursesDayShift });
      const persisted = await hospitalDB.dailyRecords.get(DATE);
      expect(persisted?.beds.R1.devices).toEqual([]);
      expect(persisted?.beds.R1.deviceDetails).toEqual(remote.beds.R1.deviceDetails);
      expect(persisted?.beds.R1.clinicalCarryover).toEqual(remote.beds.R1.clinicalCarryover);
      expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
    }
  );

  it('adopts current server clinical values instead of replaying the old quarantined snapshot', async () => {
    const { local, remote } = await setup('CONFLICT');
    remote.beds.R1.pathology = 'Diagnóstico autoritativo vigente';
    remote.beds.R1.cudyr = DataFactory.createMockCudyr({ changeClothes: 1, surveillance: 2 });
    await adoptAuthoritativeRecord(remote, { nursesDayShift: remote.nursesDayShift });
    const persisted = await hospitalDB.dailyRecords.get(DATE);
    expect(persisted?.beds.R1.cudyr).toEqual(remote.beds.R1.cudyr);
    expect(persisted?.beds.R1.cudyr).not.toEqual(local.beds.R1.cudyr);
    expect(persisted?.beds.R1.pathology).toBe(remote.beds.R1.pathology);
    expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
  });
});
