import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createDailyRecordSyncQueueActions } from '@/services/storage/sync/publicDailyRecordSyncQueueActions';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const date = '2026-10-27';
const record = (): DailyRecord =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    lastUpdated: `${date}T10:00:00.000Z`,
    nursesDayShift: ['SYNTHETIC A'],
    tensDayShift: [],
  });
const confirmed = (): DailyRecord => ({
  ...record(),
  nursesDayShift: ['NORMALIZED A'],
  lastUpdated: `${date}T11:00:00.000Z`,
});
const later = (): DailyRecord => ({ ...record(), tensDayShift: ['SYNTHETIC B'] });
const task = (payload = record(), overrides: Partial<SyncTask> = {}): SyncTask => ({
  opId: 'synthetic-a',
  type: 'UPDATE_DAILY_RECORD',
  key: `daily:${date}`,
  payload,
  timestamp: 1,
  retryCount: 0,
  status: 'PENDING',
  ownerKey: 'synthetic-owner',
  syncContract: {
    mutationId: 'synthetic-a',
    mutationIds: ['synthetic-a'],
    changedPaths: ['*'],
    expectedVersion: record().lastUpdated,
  },
  ...overrides,
});
const complete = async (mutationId = 'synthetic-a') => {
  const store = createDexieSyncQueueStore();
  if (!store.completeDirectDailyRecord) throw new Error('Missing direct ACK store operation');
  return store.completeDirectDailyRecord({
    sentRecord: record(),
    confirmedRecord: confirmed(),
    mutationId,
    ownerKey: 'synthetic-owner',
  });
};
const seed = async (projection = record(), rows = [task()]) => {
  await hospitalDB.dailyRecords.put(projection);
  await hospitalDB.syncQueue.bulkAdd(rows);
  return hospitalDB.syncQueue.toArray();
};

describe('direct full-save ACK transaction', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('adopts normalized A, retires only A and accepts an exact duplicate without replacing it', async () => {
    await seed();
    expect(await complete()).toEqual({ status: 'adopted', record: confirmed() });
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(confirmed());
    expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
    expect(await complete()).toEqual({ status: 'adopted', record: confirmed() });
  });

  it.each([
    'PENDING',
    'FAILED',
    'CONFLICT',
    'PROCESSING',
    'RETIRED',
  ] satisfies SyncTask['status'][])(
    'retains a separate %s B with its original identity, base and status',
    async status => {
      const b = task(later(), {
        opId: 'synthetic-b',
        status,
        syncContract: {
          mutationId: 'synthetic-b',
          expectedVersion: 'original-base',
          changedPaths: ['tensDayShift'],
        },
        leaseOwner: 'synthetic-worker',
        attemptId: 'synthetic-attempt',
        leaseUntil: 100,
      });
      const [, savedB] = await seed(later(), [task(), b]);
      expect(await complete()).toEqual({
        status: 'retained',
        record: later(),
        releasedHold: false,
      });
      expect(await hospitalDB.dailyRecords.get(date)).toEqual(later());
      expect(await hospitalDB.syncQueue.toArray()).toEqual([savedB]);
    }
  );

  it('retains compacted A+B without reinterpreting its wildcard or original base', async () => {
    const rows = await seed(later(), [
      task(later(), {
        syncContract: {
          mutationId: 'synthetic-a',
          mutationIds: ['synthetic-a', 'synthetic-b'],
          expectedVersion: 'original-base',
          changedPaths: ['*'],
        },
      }),
    ]);
    expect(await complete()).toEqual({ status: 'retained', record: later(), releasedHold: false });
    expect(await hospitalDB.syncQueue.toArray()).toEqual(rows);
  });

  it('releases only the matching pending mutation hold without changing its compacted intent', async () => {
    const [before] = await seed(later(), [
      task(later(), {
        preOutboxHoldState: 'AWAITING_REMOTE_ACK',
        preOutboxHoldUntil: 99999,
        preOutboxHoldOwner: 'tab-a',
        syncContract: {
          mutationId: 'synthetic-a',
          mutationIds: ['synthetic-a', 'synthetic-b'],
          changedPaths: ['*'],
        },
      }),
    ]);
    expect(await complete()).toMatchObject({ status: 'retained', releasedHold: true });
    const [after] = await hospitalDB.syncQueue.toArray();
    expect(after).toMatchObject({
      id: before.id,
      payload: before.payload,
      syncContract: before.syncContract,
      status: 'PENDING',
    });
    expect(after.preOutboxHoldUntil).toBeUndefined();
  });

  it.each([
    { ownerKey: 'foreign-owner' },
    { status: 'PROCESSING', leaseOwner: 'worker', attemptId: 'attempt' },
    { status: 'FAILED' },
    { status: 'CONFLICT' },
  ] satisfies Partial<SyncTask>[])(
    'does not retire or release an ineligible task %j',
    async overrides => {
      const rows = await seed(record(), [
        task(record(), {
          ...overrides,
          preOutboxHoldState: 'AWAITING_REMOTE_ACK',
          preOutboxHoldUntil: 99999,
        }),
      ]);
      expect(await complete()).toEqual({
        status: 'retained',
        record: record(),
        releasedHold: false,
      });
      expect(await hospitalDB.syncQueue.toArray()).toEqual(rows);
    }
  );

  it('keeps a foreign B when A is eligible', async () => {
    const [, b] = await seed(later(), [
      task(),
      task(later(), {
        ownerKey: 'foreign-owner',
        opId: 'synthetic-b',
        syncContract: { mutationId: 'synthetic-b' },
      }),
    ]);
    await complete();
    expect(await hospitalDB.syncQueue.toArray()).toEqual([b]);
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(later());
  });

  it('ignores a manually retired backup for adoption and preserves the backup', async () => {
    const backup = task(later(), {
      status: 'RETIRED',
      retirement: {
        reason: 'manual_discard',
        retiredAt: `${date}T09:00:00.000Z`,
        previousStatus: 'CONFLICT',
      },
    });
    const [, savedBackup] = await seed(record(), [task(), backup]);
    await complete();
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(confirmed());
    expect(await hospitalDB.syncQueue.toArray()).toEqual([savedBackup]);
  });

  it.each(['', '   '])(
    'rejects a missing mutation identity %j without wildcard deletion',
    async id => {
      const rows = await seed();
      await expect(complete(id)).rejects.toMatchObject({ code: 'sync_ack_invalid_record' });
      expect(await hospitalDB.syncQueue.toArray()).toEqual(rows);
      expect(await hospitalDB.dailyRecords.get(date)).toEqual(record());
    }
  );

  it('rejects ambiguous own mutation identities before modifying either row', async () => {
    const rows = await seed(record(), [task(), task()]);
    await expect(complete()).rejects.toMatchObject({ code: 'sync_ack_projection_conflict' });
    expect(await hospitalDB.syncQueue.toArray()).toEqual(rows);
  });

  it('does not infer a payload match from equal timestamps', async () => {
    const rows = await seed(later(), [task(later())]);
    expect(await complete()).toMatchObject({ status: 'retained', record: later() });
    expect(await hospitalDB.syncQueue.toArray()).toEqual(rows);
  });

  it('rejects an unqueued different local projection even at the same timestamp', async () => {
    const rows = await seed(later());
    await expect(complete()).rejects.toMatchObject({ code: 'sync_ack_projection_conflict' });
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(later());
    expect(await hospitalDB.syncQueue.toArray()).toEqual(rows);
  });

  it('rejects an old or absent task rather than replacing a different current record', async () => {
    await seed({ ...confirmed(), tensDayShift: ['SYNTHETIC C'] }, []);
    await expect(complete()).rejects.toMatchObject({ code: 'sync_ack_projection_conflict' });
    expect((await hospitalDB.dailyRecords.get(date))?.tensDayShift).toEqual(['SYNTHETIC C']);
  });

  it('rolls back when the retained projection is missing', async () => {
    const rows = await seed(later(), [
      task(),
      task(later(), { syncContract: { mutationId: 'synthetic-b' } }),
    ]);
    await hospitalDB.dailyRecords.delete(date);
    await expect(complete()).rejects.toMatchObject({ code: 'sync_ack_missing_projection' });
    expect(await hospitalDB.syncQueue.toArray()).toEqual(rows);
    expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
  });

  it('rolls back adoption and retirement together on delete failure', async () => {
    const rows = await seed();
    vi.spyOn(hospitalDB.syncQueue, 'delete').mockRejectedValueOnce(
      new Error('Synthetic delete failure')
    );
    await expect(complete()).rejects.toThrow('Synthetic delete failure');
    expect(await hospitalDB.syncQueue.toArray()).toEqual(rows);
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(record());
  });

  it('keeps A when the confirmed local put fails', async () => {
    const rows = await seed();
    vi.spyOn(hospitalDB.dailyRecords, 'put').mockRejectedValueOnce(
      new Error('Synthetic put failure')
    );
    await expect(complete()).rejects.toThrow('Synthetic put failure');
    expect(await hospitalDB.syncQueue.toArray()).toEqual(rows);
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(record());
  });

  it('retains C admitted before the ACK and never writes again after returning the retained snapshot', async () => {
    await seed();
    const c = { ...later(), tensNightShift: ['SYNTHETIC C'] };
    const cTask = task(c, { opId: 'synthetic-c', syncContract: { mutationId: 'synthetic-c' } });
    await hospitalDB.transaction('rw', hospitalDB.dailyRecords, hospitalDB.syncQueue, async () => {
      await hospitalDB.dailyRecords.put(c);
      await hospitalDB.syncQueue.add(cTask);
    });
    expect(await complete()).toMatchObject({ status: 'retained', record: c });
    const afterCommit = { ...c, nursesNightShift: ['SYNTHETIC D'] };
    await hospitalDB.dailyRecords.put(afterCommit);
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(afterCommit);
  });

  it('the public action rejects an absent mutation identity without deleting pending work', async () => {
    const rows = await seed();
    const actions = createDailyRecordSyncQueueActions({
      ensureReady: async () => {},
      store: createDexieSyncQueueStore(),
      getOwnerKey: () => 'synthetic-owner',
      logger: { warn: vi.fn() },
      replacePendingTask: async () => false,
      triggerProcessing: () => {},
    });
    await expect(
      actions.completeDirectDailyRecordSyncTask({
        sentRecord: record(),
        confirmedRecord: confirmed(),
        syncContract: {},
      })
    ).rejects.toThrow();
    expect(await hospitalDB.syncQueue.toArray()).toEqual(rows);
  });
});
