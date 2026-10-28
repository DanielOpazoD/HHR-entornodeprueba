import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const date = '2026-10-24';
const record = (lastUpdated: string, overrides: Partial<DailyRecord> = {}): DailyRecord => ({
  date,
  lastUpdated,
  beds: {},
  nurses: [],
  activeExtraBeds: [],
  discharges: [],
  transfers: [],
  cma: [],
  nursesDayShift: ['SINTETICA BASE'],
  tensDayShift: ['SINTETICO BASE'],
  ...overrides,
});
const engine = () =>
  createSyncQueueEngine({
    store: createDexieSyncQueueStore(),
    runtime: { isOnline: () => false, getOwnerKey: () => 'user:sintetico', onOnline: () => {} },
    transport: { run: async () => {} },
    batchSize: 8,
    maxPendingTasks: 192,
    maxRetries: 5,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30000,
  });

describe('queue compaction keeps every accepted pending edit', () => {
  beforeEach(async () => {
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
  });

  it('a record from a stale tab snapshot does not erase an earlier independent edit', async () => {
    const base = record('2026-10-24T10:00:00.000Z');
    const queue = engine();
    await queue.queueDailyRecordTaskWithLocalRecord(
      { ...base, lastUpdated: '2026-10-24T10:01:00.000Z', nursesDayShift: ['SINTETICA A'] },
      { syncContract: { expectedVersion: base.lastUpdated, changedPaths: ['nursesDayShift'] } }
    );
    const second = await queue.queueDailyRecordTaskWithLocalRecord(
      { ...base, lastUpdated: '2026-10-24T10:02:00.000Z', tensDayShift: ['SINTETICO B'] },
      { syncContract: { expectedVersion: base.lastUpdated, changedPaths: ['tensDayShift'] } }
    );

    expect(second).toMatchObject({ accepted: true, mode: 'reused' });
    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    const payload = tasks[0].payload as DailyRecord;
    expect(payload.nursesDayShift).toEqual(['SINTETICA A']);
    expect(payload.tensDayShift).toEqual(['SINTETICO B']);
    expect(tasks[0].syncContract?.changedPaths).toEqual(['nursesDayShift', 'tensDayShift']);
    const projection = await hospitalDB.dailyRecords.get(date);
    expect(projection?.nursesDayShift).toEqual(['SINTETICA A']);
    expect(projection?.tensDayShift).toEqual(['SINTETICO B']);
  });

  const seedAccepted = async (sameTimestamp = false, opaque = false) => {
    const base = record('2026-10-24T10:00:00.000Z');
    const accepted = {
      ...base,
      lastUpdated: sameTimestamp ? base.lastUpdated : '2026-10-24T10:01:00.000Z',
      nursesDayShift: ['SINTETICA A'],
    };
    const queue = engine();
    await queue.queueDailyRecordTaskWithLocalRecord(
      accepted,
      {
        syncContract: {
          expectedVersion: base.lastUpdated,
          changedPaths: opaque ? ['*'] : ['nursesDayShift'],
        },
      },
      { wholeRecordBase: base }
    );
    return { queue, base, accepted };
  };

  it.each(['PENDING', 'PROCESSING', 'FAILED', 'CONFLICT'] as const)(
    'rejects a stale whole save without changing an accepted %s task',
    async status => {
      const { queue, base, accepted } = await seedAccepted();
      await hospitalDB.syncQueue.toCollection().modify({ status });
      const before = await hospitalDB.syncQueue.toArray();
      await expect(
        queue.queueDailyRecordTaskWithLocalRecord(
          { ...base, lastUpdated: '2026-10-24T10:02:00.000Z', tensDayShift: ['SINTETICO B'] },
          { syncContract: { expectedVersion: base.lastUpdated, changedPaths: ['*'] } },
          { wholeRecordBase: base }
        )
      ).rejects.toMatchObject({ name: 'ConcurrencyError' });
      expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
      expect(await hospitalDB.dailyRecords.get(date)).toEqual(accepted);
    }
  );

  it('does not use an equal timestamp as proof of the whole-save base', async () => {
    const { queue, base, accepted } = await seedAccepted(true);
    await expect(
      queue.queueDailyRecordTaskWithLocalRecord(
        base,
        { syncContract: { expectedVersion: base.lastUpdated, changedPaths: ['*'] } },
        { wholeRecordBase: base }
      )
    ).rejects.toMatchObject({ name: 'ConcurrencyError' });
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(accepted);
  });

  it('requires a base before replacing a different accepted value in a legacy full write', async () => {
    const { queue, base, accepted } = await seedAccepted();
    await expect(
      queue.queueDailyRecordTaskWithLocalRecord(base, { syncContract: { changedPaths: ['*'] } })
    ).rejects.toMatchObject({ name: 'ConcurrencyError' });
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(accepted);
  });

  it('accepts a whole save that already keeps the independent accepted value', async () => {
    const { queue, base, accepted } = await seedAccepted();
    const next = {
      ...accepted,
      lastUpdated: '2026-10-24T10:02:00.000Z',
      tensDayShift: ['SINTETICO B'],
    };
    await queue.queueDailyRecordTaskWithLocalRecord(
      next,
      { syncContract: { changedPaths: ['*'] } },
      { wholeRecordBase: base }
    );
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(next);
    expect((await hospitalDB.syncQueue.toArray())[0].payload).toEqual(next);
  });

  it('allows an intentional replacement after its writer reads the accepted projection', async () => {
    const { queue, accepted } = await seedAccepted();
    const next = { ...accepted, nursesDayShift: ['SINTETICA B'] };
    await queue.queueDailyRecordTaskWithLocalRecord(
      next,
      { syncContract: { changedPaths: ['*'] } },
      { wholeRecordBase: accepted }
    );
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(next);
  });

  it('keeps empty cache defaults equivalent when a full task already owns the day', async () => {
    const { queue, base, accepted } = await seedAccepted(false, true);
    const next = {
      ...accepted,
      lastUpdated: '2026-10-24T10:02:00.000Z',
      rayenSyncHistory: [],
      bedTypeOverrides: {},
      handoffNovedadesDayShift: '',
    };
    await queue.queueDailyRecordTaskWithLocalRecord(
      next,
      { syncContract: { changedPaths: ['*'] } },
      { wholeRecordBase: base }
    );
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(next);
  });

  it('preserves the accepted payload when its local projection is missing', async () => {
    const { queue, base } = await seedAccepted();
    await hospitalDB.dailyRecords.delete(date);
    const before = await hospitalDB.syncQueue.toArray();
    await expect(
      queue.queueDailyRecordTaskWithLocalRecord(
        base,
        { syncContract: { changedPaths: ['*'] } },
        { wholeRecordBase: base }
      )
    ).rejects.toMatchObject({ name: 'ConcurrencyError' });
    expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
    expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
  });

  it('can restore the exact accepted payload without inventing a new base', async () => {
    const { queue, accepted } = await seedAccepted();
    await hospitalDB.dailyRecords.delete(date);
    await queue.queueDailyRecordTaskWithLocalRecord(accepted, {
      syncContract: { changedPaths: ['*'] },
    });
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(accepted);
  });

  it('does not erase durable work hidden by an older cache projection', async () => {
    const { queue, base } = await seedAccepted();
    await hospitalDB.dailyRecords.put(base);
    const before = await hospitalDB.syncQueue.toArray();
    await expect(
      queue.queueDailyRecordTaskWithLocalRecord(
        base,
        { syncContract: { changedPaths: ['*'] } },
        { wholeRecordBase: base }
      )
    ).rejects.toMatchObject({ name: 'ConcurrencyError' });
    expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
  });

  it('does not drop an accepted opaque task when another full save has a stale base', async () => {
    const { queue, base, accepted } = await seedAccepted(false, true);
    await expect(
      queue.queueDailyRecordTaskWithLocalRecord(
        base,
        { syncContract: { changedPaths: ['*'] } },
        { wholeRecordBase: base }
      )
    ).rejects.toMatchObject({ name: 'ConcurrencyError' });
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(accepted);
  });

  it.each(['older', 'missing'] as const)(
    'checks both durable tasks when the cache projection is %s',
    async cache => {
      const { queue, accepted } = await seedAccepted();
      await hospitalDB.syncQueue.toCollection().modify({ status: 'PROCESSING' });
      const newer = { ...accepted, tensDayShift: ['SINTETICO B'] };
      await queue.queueDailyRecordTaskWithLocalRecord(newer, {
        syncContract: { changedPaths: ['tensDayShift'] },
      });
      const [olderTask, newerTask] = await hospitalDB.syncQueue.toArray();
      await hospitalDB.syncQueue.update(olderTask.id!, { status: 'PENDING' });
      await hospitalDB.syncQueue.update(newerTask.id!, { status: 'PROCESSING' });
      if (cache === 'older') await hospitalDB.dailyRecords.put(accepted);
      else await hospitalDB.dailyRecords.delete(date);
      const before = await hospitalDB.syncQueue.toArray();

      await expect(
        queue.queueDailyRecordTaskWithLocalRecord(
          accepted,
          { syncContract: { changedPaths: ['*'] } },
          { wholeRecordBase: accepted }
        )
      ).rejects.toMatchObject({ name: 'ConcurrencyError' });
      expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
      expect(await hospitalDB.dailyRecords.get(date)).toEqual(
        cache === 'older' ? accepted : undefined
      );

      await queue.queueDailyRecordTaskWithLocalRecord(
        newer,
        { syncContract: { changedPaths: ['*'] } },
        { wholeRecordBase: newer }
      );
      expect(await hospitalDB.dailyRecords.get(date)).toEqual(newer);
    }
  );

  it.each([false, true])(
    'keeps an opaque pending deletion when a stale full save has a base: %s',
    async hasBase => {
      const base = record('2026-10-24T10:00:00.000Z', {
        handoffNovedadesDayShift: 'SINTETICO RETIRADO',
      });
      const accepted = record('2026-10-24T10:01:00.000Z');
      const queue = engine();
      await queue.queueDailyRecordTaskWithLocalRecord(
        accepted,
        { syncContract: { changedPaths: ['*'] } },
        { wholeRecordBase: base }
      );
      const before = await hospitalDB.syncQueue.toArray();
      await expect(
        queue.queueDailyRecordTaskWithLocalRecord(
          base,
          { syncContract: { changedPaths: ['*'] } },
          hasBase ? { wholeRecordBase: base } : undefined
        )
      ).rejects.toMatchObject({ name: 'ConcurrencyError' });
      expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
      expect(await hospitalDB.dailyRecords.get(date)).toEqual(accepted);

      await queue.queueDailyRecordTaskWithLocalRecord(
        base,
        { syncContract: { changedPaths: ['*'] } },
        { wholeRecordBase: accepted }
      );
      expect((await hospitalDB.dailyRecords.get(date))?.handoffNovedadesDayShift).toBe(
        'SINTETICO RETIRADO'
      );
    }
  );

  it.each([false, true])(
    'allows a fresh full save after a later edit supersedes an older opaque task: %s',
    async opaque => {
      const { queue, accepted } = await seedAccepted(false, opaque);
      await hospitalDB.syncQueue.toCollection().modify({ status: 'PROCESSING' });
      const newer = { ...accepted, nursesDayShift: ['SINTETICA B'] };
      await queue.queueDailyRecordTaskWithLocalRecord(newer, {
        syncContract: { changedPaths: ['nursesDayShift'] },
      });
      const tasks = await hospitalDB.syncQueue.toArray();
      expect(tasks).toHaveLength(2);
      await hospitalDB.dailyRecords.put(accepted);
      await expect(
        queue.queueDailyRecordTaskWithLocalRecord(
          accepted,
          { syncContract: { changedPaths: ['*'] } },
          { wholeRecordBase: accepted }
        )
      ).rejects.toMatchObject({ name: 'ConcurrencyError' });
      expect(await hospitalDB.syncQueue.toArray()).toEqual(tasks);
      await hospitalDB.dailyRecords.delete(date);
      const next = { ...newer, tensDayShift: ['SINTETICO C'] };
      await queue.queueDailyRecordTaskWithLocalRecord(
        next,
        { syncContract: { changedPaths: ['*'] } },
        { wholeRecordBase: newer }
      );
      expect(await hospitalDB.dailyRecords.get(date)).toEqual(next);
      expect((await hospitalDB.syncQueue.toArray())[0]).toEqual(tasks[0]);
      expect((await hospitalDB.syncQueue.toArray())[1].payload).toEqual(next);
    }
  );

  it('protects ancestor paths without making the later task publish them', async () => {
    const { queue, base, accepted } = await seedAccepted();
    await hospitalDB.syncQueue.toCollection().modify({ status: 'PROCESSING' });
    const newer = { ...accepted, tensDayShift: ['SINTETICO B'] };
    await queue.queueDailyRecordTaskWithLocalRecord(newer, {
      syncContract: { changedPaths: ['tensDayShift'] },
    });
    const before = await hospitalDB.syncQueue.toArray();
    expect(before[1].syncContract?.changedPaths).toEqual(['tensDayShift']);
    const stale = { ...base, tensDayShift: newer.tensDayShift };
    await expect(
      queue.queueDailyRecordTaskWithLocalRecord(
        stale,
        { syncContract: { changedPaths: ['*'] } },
        { wholeRecordBase: stale }
      )
    ).rejects.toMatchObject({ name: 'ConcurrencyError' });
    expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(newer);
  });

  it('does not infer a missing local base from publication receipt ids', async () => {
    const { queue, accepted } = await seedAccepted();
    await hospitalDB.syncQueue.toCollection().modify({ status: 'PROCESSING' });
    const newer = { ...accepted, nursesDayShift: ['SINTETICA B'] };
    await queue.queueDailyRecordTaskWithLocalRecord(newer, {
      syncContract: { changedPaths: ['nursesDayShift'] },
    });
    const tasks = await hospitalDB.syncQueue.toArray();
    await hospitalDB.syncQueue.toCollection().modify(task => {
      delete task.localProjectionBaseIds;
    });
    await hospitalDB.syncQueue.update(tasks[1].id!, {
      syncContract: {
        ...tasks[1].syncContract,
        mutationIds: tasks
          .map(task => task.syncContract?.mutationId)
          .filter(id => typeof id === 'string'),
      },
    });
    const before = await hospitalDB.syncQueue.toArray();
    await expect(
      queue.queueDailyRecordTaskWithLocalRecord(
        newer,
        { syncContract: { changedPaths: ['*'] } },
        { wholeRecordBase: newer }
      )
    ).rejects.toMatchObject({ name: 'ConcurrencyError' });
    expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(newer);
  });

  it('allows a fresh full save after three same-field edits with equal timestamps', async () => {
    const { queue, accepted } = await seedAccepted();
    let current = accepted;
    for (const nurse of ['SINTETICA B', 'SINTETICA C']) {
      await hospitalDB.syncQueue.toCollection().modify({ status: 'PROCESSING' });
      current = { ...current, nursesDayShift: [nurse] };
      await queue.queueDailyRecordTaskWithLocalRecord(current, {
        syncContract: { changedPaths: ['nursesDayShift'] },
      });
    }
    const before = await hospitalDB.syncQueue.toArray();
    const next = { ...current, tensDayShift: ['SINTETICO D'] };
    await queue.queueDailyRecordTaskWithLocalRecord(
      next,
      { syncContract: { changedPaths: ['*'] } },
      { wholeRecordBase: current }
    );
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(next);
    expect((await hospitalDB.syncQueue.toArray()).slice(0, 2)).toEqual(before.slice(0, 2));
  });

  it('does not treat an identical pending clinical value as permission to replace its episode', async () => {
    const patient = DataFactory.createMockPatient('R1', {
      clinicalEpisodeId: 'synthetic-episode-a',
      pathology: 'BASE',
    });
    const base = record('2026-10-24T10:00:00.000Z', { beds: { R1: patient } });
    const accepted = { ...base, beds: { R1: { ...patient, pathology: 'ACCEPTED A' } } };
    const queue = engine();
    await queue.queueDailyRecordTaskWithLocalRecord(accepted, {
      syncContract: { changedPaths: ['beds.R1.pathology'] },
    });
    const replacement = {
      ...accepted,
      beds: {
        R1: { ...patient, clinicalEpisodeId: 'synthetic-episode-b', pathology: 'ACCEPTED A' },
      },
    };
    await expect(
      queue.queueDailyRecordTaskWithLocalRecord(
        replacement,
        { syncContract: { changedPaths: ['*'] } },
        { wholeRecordBase: base }
      )
    ).rejects.toMatchObject({ name: 'ConcurrencyError' });
    expect((await hospitalDB.dailyRecords.get(date))?.beds.R1.clinicalEpisodeId).toBe(
      'synthetic-episode-a'
    );
  });
});
