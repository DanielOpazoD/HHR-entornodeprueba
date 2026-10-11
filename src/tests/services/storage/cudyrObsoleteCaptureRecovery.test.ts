import 'fake-indexeddb/auto';
import { EMPTY_PATIENT } from '@/constants/patient';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import {
  createObsoleteCudyrCaptureRecovery,
  isObsoleteEmptyCudyrCandidate,
} from '@/services/storage/sync/cudyrObsoleteCaptureRecovery';
import { buildSyncQueueTelemetryFromRows } from '@/services/storage/sync/syncQueueTelemetryController';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const request = () => ({
  schemaVersion: 1 as const,
  authorityDate: '2026-10-10',
  runId: 'old',
  evaluations: [],
  capture: {
    id: 'capture',
    clinicalEpisodeId: 'discharged',
    sourceRunId: 'old',
    observedAt: '2026-10-10T16:00:00Z',
    status: 'not_observed' as const,
    metadataStatus: 'complete' as const,
    part: 0,
    totalParts: 1,
    totalEvaluations: 0,
  },
});
const task = (overrides: Partial<SyncTask> = {}): SyncTask => ({
  opId: 'op',
  type: 'ARCHIVE_CUDYR',
  status: 'FAILED',
  ownerKey: 'owner',
  timestamp: 1,
  retryCount: 1,
  lastErrorCode: 'functions/failed-precondition',
  error:
    '[validation/functions/failed-precondition] CUDYR episode is absent from the authoritative census and movements.',
  payload: { id: 'outbox', request: request() },
  ...overrides,
});
const census = () =>
  ({
    date: '2026-10-10',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '',
    rayenSync: { runId: 'new' },
    rayenSyncHistory: [
      {
        id: 'new',
        sourceDate: '2026-10-10',
        status: 'complete',
        structuralReview: { snapshotComplete: true },
      },
    ],
  }) as unknown as DailyRecord;
const setup = () => {
  const store = createDexieSyncQueueStore();
  let owner = 'owner',
    generation = 'session',
    authorized = true;
  const read = vi.fn(async () => census());
  const recover = createObsoleteCudyrCaptureRecovery({
    store,
    getOwner: () => owner,
    getGeneration: () => generation,
    readConfirmedCensus: read,
    now: () => new Date('2026-10-10T21:00:00Z'),
  });
  return {
    store,
    read,
    run: () => recover('session', () => authorized),
    setOwner: (v: string) => {
      owner = v;
    },
    revoke: () => {
      authorized = false;
    },
    changeSession: () => {
      generation = 'other';
    },
  };
};
beforeEach(async () => {
  await hospitalDB.syncQueue.clear();
});

describe('obsolete empty CUDYR checks', () => {
  it('retires three obsolete checks without deleting payloads or claiming Firebase acknowledgement', async () => {
    await hospitalDB.syncQueue.bulkAdd([task(), task({ opId: 'two' }), task({ opId: 'three' })]);
    const before = await hospitalDB.syncQueue.toArray();
    const s = setup();
    expect(await s.run()).toBe(3);
    expect(s.read).toHaveBeenCalledTimes(1);
    const rows = await hospitalDB.syncQueue.toArray();
    expect(rows.map(t => t.payload)).toEqual(before.map(t => t.payload));
    expect(rows.every(t => t.status === 'RETIRED' && t.retirement?.verifiedRunId === 'new')).toBe(
      true
    );
    expect(buildSyncQueueTelemetryFromRows(rows, 1, 50)).toMatchObject({
      pending: 0,
      failed: 0,
      conflict: 0,
    });
    expect(
      await s.store.claimReadyPending(100, 50, 'owner', {
        leaseOwner: 'tab',
        leaseUntil: 200,
        attemptId: 'try',
      })
    ).toEqual([]);
    expect(await s.run()).toBe(0);
  });
  it.each(['evaluations', 'placements', 'partial', 'parts', 'source-error'])(
    'never retires %s or other pending data',
    mode => {
      const r = request();
      if (mode === 'evaluations')
        (r.evaluations as unknown[]).push({ clinicalEpisodeId: 'discharged' });
      if (mode === 'placements') Object.assign(r.capture, { sourcePlacements: [{}] });
      if (mode === 'partial') Object.assign(r.capture, { metadataStatus: 'partial' });
      if (mode === 'parts') r.capture.totalParts = 2;
      if (mode === 'source-error') Object.assign(r.capture, { status: 'unavailable' });
      expect(isObsoleteEmptyCudyrCandidate(task({ payload: { request: r } }))).toBe(false);
    }
  );
  it.each(['PENDING', 'PROCESSING', 'CONFLICT', 'RETIRED'] as const)(
    'does not change an %s task',
    status => {
      expect(isObsoleteEmptyCudyrCandidate(task({ status }))).toBe(false);
    }
  );
  it.each(['bed', 'crib', 'discharge', 'transfer', 'cma'])(
    'keeps a check whose episode has an authoritative %s context',
    async section => {
      await hospitalDB.syncQueue.add(task());
      const s = setup(),
        record = census();
      const patient = {
        ...EMPTY_PATIENT,
        bedId: 'H1C1',
        clinicalEpisodeId: 'discharged',
        patientName: 'Synthetic',
      };
      if (section === 'bed') record.beds = { H1C1: patient } as DailyRecord['beds'];
      else if (section === 'crib')
        record.beds = { H1C1: { ...EMPTY_PATIENT, bedId: 'H1C1', clinicalCrib: patient } };
      else
        (
          record[
            section === 'discharge' ? 'discharges' : section === 'transfer' ? 'transfers' : 'cma'
          ] as unknown[]
        ).push(patient);
      s.read.mockResolvedValue(record);
      expect(await s.run()).toBe(0);
      expect((await hospitalDB.syncQueue.toArray())[0].status).toBe('FAILED');
    }
  );
  it('never retires tasks without a complete, dated authoritative run', async () => {
    await hospitalDB.syncQueue.add(task());
    const s = setup();
    const record = census();
    record.rayenSyncHistory![0].status = 'partial';
    s.read.mockResolvedValue(record);
    expect(await s.run()).toBe(0);
  });
  it.each([false, undefined])(
    'does not infer source census completeness from a completed run (%s)',
    complete => {
      const record = census();
      record.rayenSyncHistory![0].structuralReview = {
        snapshotComplete: complete,
        historicalCorrectionsPending: false,
        historicalCorrectionsRequireFreshCapture: false,
        isolatedConflicts: 0,
      };
      const s = setup();
      s.read.mockResolvedValue(record);
      return hospitalDB.syncQueue.add(task()).then(async () => {
        expect(await s.run()).toBe(0);
        expect((await hospitalDB.syncQueue.toArray())[0].status).toBe('FAILED');
      });
    }
  );
  it('does not touch foreign owners or unowned rows', async () => {
    await hospitalDB.syncQueue.bulkAdd([
      task({ ownerKey: 'foreign' }),
      task({ ownerKey: undefined }),
    ]);
    const s = setup();
    expect(await s.run()).toBe(0);
    expect(s.read).not.toHaveBeenCalled();
  });
  it.each(['owner', 'session', 'policy'])(
    'rejects %s changes during the server read',
    async kind => {
      await hospitalDB.syncQueue.add(task());
      const s = setup();
      s.read.mockImplementation(async () => {
        if (kind === 'owner') s.setOwner('other');
        else if (kind === 'session') s.changeSession();
        else s.revoke();
        return census();
      });
      expect(await s.run()).toBe(0);
      expect((await hospitalDB.syncQueue.toArray())[0].status).toBe('FAILED');
    }
  );
  it('rechecks changed content and preserves a newly added evaluation', async () => {
    const id = await hospitalDB.syncQueue.add(task());
    const s = setup();
    s.read.mockImplementation(async () => {
      const r = request();
      (r.evaluations as unknown[]).push({ clinicalEpisodeId: 'discharged' });
      await hospitalDB.syncQueue.update(id, { payload: { request: r } });
      return census();
    });
    expect(await s.run()).toBe(0);
    expect((await hospitalDB.syncQueue.get(id))?.status).toBe('FAILED');
  });
  it('rolls back retirement if authorization changes in the transaction', async () => {
    await hospitalDB.syncQueue.bulkAdd([task(), task({ opId: 'two' })]);
    const s = setup(),
      update = s.store.update;
    s.store.update = async (...args) => {
      await update(...args);
      s.revoke();
    };
    await expect(s.run()).rejects.toThrow('autorización cambió');
    expect((await hospitalDB.syncQueue.toArray()).every(t => t.status === 'FAILED')).toBe(true);
  });
});
