import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createMisdatedCudyrAuthorityRecovery } from '@/services/storage/sync/cudyrMisdatedAuthorityRecovery';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { CudyrArchiveOutboxPayload } from '@/types/domain/cudyrHistory';

const task = (): SyncTask => ({
  opId: 'op',
  ownerKey: 'owner',
  type: 'ARCHIVE_CUDYR',
  status: 'FAILED',
  timestamp: 1,
  retryCount: 1,
  error: '[unknown/unknown] No se pudo verificar la ejecución del censo para archivar CUDYR.',
  payload: {
    id: 'queued',
    request: {
      schemaVersion: 1,
      authorityDate: '2026-10-11',
      runId: 'original',
      evaluations: [
        {
          clinicalEpisodeId: 'E1',
          sourceEvaluationId: 'eval',
          source: 'gestion_camas',
          category: 'C2',
          recordedAt: '2026-10-11T03:00:00-05:00',
        },
      ],
      capture: {
        id: 'capture',
        clinicalEpisodeId: 'E1',
        sourceRunId: 'original',
        observedAt: '2026-10-11T14:00:00.000Z',
        status: 'observed',
        metadataStatus: 'partial',
        part: 0,
        totalParts: 1,
        totalEvaluations: 1,
      },
    },
  },
});
const census = (): DailyRecord =>
  ({
    date: '2026-10-10',
    rayenSyncHistory: [{ id: 'original', sourceDate: '2026-10-10', status: 'partial' }],
  }) as unknown as DailyRecord;
const setup = () => {
  let owner = 'owner',
    generation = 'session',
    authorized = true;
  const read = vi.fn(async () => census());
  const recover = createMisdatedCudyrAuthorityRecovery({
    store: createDexieSyncQueueStore(),
    getOwner: () => owner,
    getGeneration: () => generation,
    readConfirmedCensus: read,
  });
  return {
    read,
    run: () => recover('session', () => authorized),
    revoke: () => {
      authorized = false;
    },
    changeOwner: () => {
      owner = 'other';
    },
    changeSession: () => {
      generation = 'other';
    },
  };
};
beforeEach(async () => {
  await hospitalDB.syncQueue.clear();
});
describe('misdated CUDYR archive recovery', () => {
  it('reaches a provable capture beyond 50 unprovable entries', async () => {
    const rows = Array.from({ length: 51 }, (_, i) => {
      const row = task();
      const payload = row.payload as CudyrArchiveOutboxPayload;
      payload.request.runId = 'unprovable';
      payload.request.capture!.sourceRunId = 'unprovable';
      return { ...row, opId: `old-${i}` };
    });
    await hospitalDB.syncQueue.bulkAdd([...rows, task()]);
    const s = setup();
    expect(await s.run()).toBe(1);
    expect(s.read).toHaveBeenCalledOnce();
    expect((await hospitalDB.syncQueue.toArray()).filter(t => t.status === 'PENDING')).toHaveLength(
      1
    );
  });
  it('limits verified repairs to 50 and continues the rest on the next confirmed sync', async () => {
    await hospitalDB.syncQueue.bulkAdd(
      Array.from({ length: 61 }, (_, i) => ({ ...task(), opId: `op-${i}` }))
    );
    const s = setup();
    expect(await s.run()).toBe(50);
    expect(await s.run()).toBe(11);
    expect(await s.run()).toBe(0);
  });
  it('repairs only authorityDate and requeues without changing source content or claiming an ACK', async () => {
    await hospitalDB.syncQueue.bulkAdd([task(), { ...task(), opId: 'two' }]);
    const s = setup();
    expect(await s.run()).toBe(2);
    expect(s.read).toHaveBeenCalledOnce();
    const rows = await hospitalDB.syncQueue.toArray();
    for (const row of rows) {
      expect(row.status).toBe('PENDING');
      expect(row.payload).toEqual({
        ...(task().payload as CudyrArchiveOutboxPayload),
        request: {
          ...(task().payload as CudyrArchiveOutboxPayload).request,
          authorityDate: '2026-10-10',
        },
      });
    }
    expect(await s.run()).toBe(0);
  });
  it.each(['missing', 'wrong-run', 'wrong-date', 'failed-run'])(
    'keeps pending data when evidence is %s',
    async mode => {
      await hospitalDB.syncQueue.add(task());
      const s = setup();
      const r = census();
      if (mode === 'wrong-run') r.rayenSyncHistory![0].id = 'unrelated';
      if (mode === 'wrong-date') r.rayenSyncHistory![0].sourceDate = '2026-10-09';
      if (mode === 'failed-run') r.rayenSyncHistory![0].status = 'failed';
      s.read.mockResolvedValue(mode === 'missing' ? (null as unknown as DailyRecord) : r);
      expect(await s.run()).toBe(0);
      expect((await hospitalDB.syncQueue.toArray())[0].payload).toEqual(task().payload);
    }
  );
  it.each(['owner', 'session', 'authorization'])(
    'stops on a changed %s during the server read',
    async mode => {
      await hospitalDB.syncQueue.add(task());
      const s = setup();
      s.read.mockImplementation(async () => {
        if (mode === 'owner') s.changeOwner();
        if (mode === 'session') s.changeSession();
        if (mode === 'authorization') s.revoke();
        return census();
      });
      expect(await s.run()).toBe(0);
      expect((await hospitalDB.syncQueue.toArray())[0].status).toBe('FAILED');
    }
  );
  it('preserves unrelated validation failures and active tasks', async () => {
    await hospitalDB.syncQueue.bulkAdd([
      { ...task(), error: 'Invalid CUDYR capture receipt.' },
      { ...task(), status: 'PROCESSING' },
      { ...task(), ownerKey: 'foreign' },
    ]);
    const s = setup();
    expect(await s.run()).toBe(0);
    expect(s.read).not.toHaveBeenCalled();
  });
});
