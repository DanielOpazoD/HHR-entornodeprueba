import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Timestamp, type Firestore, type Transaction } from 'firebase/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { ConcurrencyError } from '@/services/storage/syncErrorCatalog';
import { UNKNOWN_SERVER_VERSION } from '@/services/storage/sync/syncTaskContractPolicy';
import type { SyncTask, SyncTaskContract } from '@/services/storage/syncQueueTypes';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  transaction: vi.fn(),
  transactionRead: vi.fn(),
  set: vi.fn(),
  directSet: vi.fn(),
  callable: vi.fn(),
  mode: 'client_only',
}));
vi.mock('firebase/firestore', async original => ({
  ...(await original<typeof import('firebase/firestore')>()),
  getDoc: mocks.read,
  runTransaction: mocks.transaction,
  setDoc: mocks.directSet,
}));
vi.mock('@/services/storage/firestore/firestoreShared', async original => ({
  ...(await original<typeof import('@/services/storage/firestore/firestoreShared')>()),
  getRecordDocRef: () => ({ id: 'synthetic-record' }),
}));
vi.mock('@/services/storage/firestore/firestoreRayenClinicalAuthorityMode', () => ({
  resolveEffectiveDailyRecordAuthorityMode: async () => mocks.mode,
  isServerClinicalWriteFenceActive: async () => false,
}));
vi.mock('@/services/storage/firestore/dailyRecordAuthorityCallableClient', () => ({
  saveDailyRecordWithClinicalAuthorityCallable: mocks.callable,
}));

const date = '2026-10-28';
const baseTime = `${date}T10:00:00.000Z`;
const payloadTime = `${date}T10:01:00.000Z`;
const earlier = `${date}T09:59:59.999Z`;
const later = `${date}T10:00:00.001Z`;
const record = (lastUpdated = payloadTime) =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    nurses: ['SINTETICA BASE', ''],
    nursesDayShift: ['SINTETICA BASE', ''],
    tensDayShift: ['SINTETICO B', '', ''],
    lastUpdated,
  });
const stored = (overrides: Record<string, unknown> = {}) => ({
  ...record(baseTime),
  tensDayShift: ['SINTETICO A', '', ''],
  meta: { revision: 7, lastMutationId: 'synthetic-A', lastChangedPaths: ['nursesDayShift'] },
  ...overrides,
});
const task = (contract: SyncTaskContract = {}): SyncTask => ({
  opId: 'synthetic-op-B',
  type: 'UPDATE_DAILY_RECORD',
  payload: record(),
  timestamp: 1,
  retryCount: 0,
  status: 'PENDING',
  syncContract: {
    changedPaths: ['*'],
    expectedVersion: baseTime,
    mutationId: 'synthetic-B',
    ...contract,
  },
});
const snapshot = (data: unknown) => ({ exists: () => true, data: () => data });
const missing = () => ({ exists: () => false });
const tx = () => ({ get: mocks.transactionRead, set: mocks.set }) as unknown as Transaction;
const run = (input: SyncTask) =>
  createFirestoreSyncTransport({
    getDb: () => ({}) as Firestore,
    ready: Promise.resolve(),
  }).run(input);
const remote = (data: unknown) => {
  mocks.read.mockResolvedValue(snapshot(data));
  mocks.transactionRead.mockResolvedValue(snapshot(data));
};
const expectBlocked = async (input: SyncTask, data: unknown) => {
  remote(data);
  const beforeTask = structuredClone(input);
  const beforeRemote = structuredClone(data);
  await expect(run(input)).rejects.toMatchObject({
    name: 'ConcurrencyError',
    reason: 'semantic_conflict',
  });
  expect(input).toEqual(beforeTask);
  expect(data).toEqual(beforeRemote);
  expect(mocks.set).not.toHaveBeenCalled();
  expect(mocks.directSet).not.toHaveBeenCalled();
  expect(mocks.callable).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.mode = 'client_only';
  mocks.read.mockResolvedValue(missing());
  mocks.transactionRead.mockResolvedValue(missing());
  mocks.transaction.mockImplementation(async (_db, callback) => callback(tx()));
  mocks.callable.mockImplementation(async ({ record: committed }: { record: DailyRecord }) => ({
    recordState: { record: committed, lastUpdated: committed.lastUpdated },
  }));
});

describe.each(['direct', 'callable'])('opaque full-save base through %s', lane => {
  beforeEach(() => {
    mocks.mode = lane === 'direct' ? 'client_only' : 'enforced';
  });

  it.each([
    ['legacy timestamp', {}, stored()],
    ['revision and timestamp', { baseRevision: 7 }, stored()],
    ['revision without timestamp', { baseRevision: 7, expectedVersion: undefined }, stored()],
    [
      'zero and legacy remote',
      { baseRevision: 0, expectedVersion: undefined },
      stored({ meta: {} }),
    ],
    [
      'zero and remote zero',
      { baseRevision: 0, expectedVersion: undefined },
      stored({ meta: { revision: 0 } }),
    ],
    ['normalized timestamp', { expectedVersion: `${date}T05:00:00-05:00` }, stored()],
    ['Firestore timestamp', {}, stored({ lastUpdated: Timestamp.fromDate(new Date(baseTime)) })],
  ])('publishes against the current %s base', async (_label, contract, data) => {
    remote(data);
    const input = task(contract);
    const before = structuredClone(input);

    await expect(run(input)).resolves.toMatchObject({ authoritativeRecord: record() });

    expect(input).toEqual(before);
    if (lane === 'direct') {
      expect(mocks.set).toHaveBeenCalledOnce();
      expect(mocks.set.mock.calls[0][1]).toMatchObject(record());
      expect(mocks.callable).not.toHaveBeenCalled();
    } else {
      expect(mocks.callable).toHaveBeenCalledOnce();
      expect(mocks.callable.mock.calls[0][0]).toMatchObject({
        record: record(),
        expectedLastUpdated: input.syncContract?.expectedVersion,
        syncContract: input.syncContract,
      });
      expect(mocks.set).not.toHaveBeenCalled();
    }
    expect(mocks.directSet).not.toHaveBeenCalled();
  });

  it.each([[undefined], [[]], [['*']]])('treats paths %j as opaque', async changedPaths => {
    await expectBlocked(task({ changedPaths, expectedVersion: earlier }), stored());
  });

  it('blocks a legacy task without a contract instead of deriving its base from the payload', async () => {
    const input = task();
    delete input.syncContract;
    await expectBlocked(input, stored());
  });

  it.each([
    ['changed revision with equal timestamp', { baseRevision: 6 }, stored()],
    ['zero versus remote one', { baseRevision: 0 }, stored({ meta: { revision: 1 } })],
    ['remote clock ahead', { expectedVersion: earlier }, stored()],
    ['remote clock behind', { expectedVersion: later }, stored()],
    [
      'equal revision with remote clock ahead',
      { baseRevision: 7, expectedVersion: earlier },
      stored(),
    ],
    [
      'equal revision with remote clock behind',
      { baseRevision: 7, expectedVersion: later },
      stored(),
    ],
    ['missing version', { expectedVersion: undefined }, stored()],
    ['empty version', { expectedVersion: '' }, stored()],
    ['invalid version', { expectedVersion: 'unreadable' }, stored()],
    [
      'invalid supplied version with revision',
      { baseRevision: 7, expectedVersion: 'unreadable' },
      stored(),
    ],
    ['empty supplied version with revision', { baseRevision: 7, expectedVersion: '' }, stored()],
    ['missing remote version', {}, stored({ lastUpdated: undefined })],
    ['invalid remote version', {}, stored({ lastUpdated: 'unreadable' })],
    [
      'invalid remote version with revision',
      { baseRevision: 7 },
      stored({ lastUpdated: 'unreadable' }),
    ],
    [
      'two invalid versions',
      { expectedVersion: 'unreadable' },
      stored({ lastUpdated: 'unreadable' }),
    ],
    ['unknown base', { expectedVersion: UNKNOWN_SERVER_VERSION }, stored()],
    [
      'unknown base with revision',
      { baseRevision: 7, expectedVersion: UNKNOWN_SERVER_VERSION },
      stored(),
    ],
  ])('preserves the task for %s', async (_label, contract, data) => {
    await expectBlocked(task(contract), data);
  });

  it.each([null, false, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'unreadable', ''])(
    'requires an exact timestamp when the persisted revision is invalid (%j)',
    async baseRevision => {
      const input = task({ expectedVersion: undefined });
      Object.assign(input.syncContract ?? {}, { baseRevision });
      await expectBlocked(input, stored({ meta: { revision: 0 } }));
    }
  );

  it('retains the exact-timestamp fallback for an invalid revision', async () => {
    remote(stored());
    const input = task();
    Object.assign(input.syncContract ?? {}, { baseRevision: null });
    await expect(run(input)).resolves.toMatchObject({ authoritativeRecord: record() });
  });

  it('accepts a persisted decimal zero as an explicit revision', async () => {
    remote(stored({ meta: {} }));
    const input = task({ expectedVersion: undefined });
    Object.assign(input.syncContract ?? {}, { baseRevision: '0' });
    await expect(run(input)).resolves.toMatchObject({ authoritativeRecord: record() });
  });

  it.each([undefined, '', baseTime])(
    'preserves absent-day creation with expected %j',
    async expectedVersion => {
      const input = task({ expectedVersion });
      await expect(run(input)).resolves.toMatchObject({ authoritativeRecord: record() });
    }
  );

  it('blocks UNKNOWN even when the day is absent', async () => {
    await expect(run(task({ expectedVersion: UNKNOWN_SERVER_VERSION }))).rejects.toMatchObject({
      name: 'ConcurrencyError',
      reason: 'semantic_conflict',
    });
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it('acknowledges the exact uncompacted receipt before checking the base', async () => {
    remote(
      stored({
        tensDayShift: ['SINTETICO B', '', ''],
        meta: { revision: 8, lastMutationId: 'synthetic-B' },
      })
    );
    await expect(run(task({ expectedVersion: UNKNOWN_SERVER_VERSION }))).resolves.toMatchObject({
      authoritativeRecord: { tensDayShift: ['SINTETICO B', '', ''] },
    });
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.callable).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(['synthetic-A', 'synthetic-B'])(
    'does not acknowledge compacted A+B from the partial marker %s',
    async lastMutationId => {
      await expectBlocked(
        task({ expectedVersion: earlier, mutationIds: ['synthetic-A', 'synthetic-B'] }),
        stored({ meta: { revision: 7, lastMutationId } })
      );
    }
  );

  it.each([-1, 0, 1])(
    'blocks A+B with changed base regardless of payload clock offset %ims',
    async offset => {
      const input = task({
        expectedVersion: earlier,
        baseRevision: 7,
        mutationIds: ['synthetic-A', 'synthetic-B'],
      });
      input.payload = record(new Date(Date.parse(baseTime) + offset).toISOString());
      await expectBlocked(input, stored());
    }
  );

  it('keeps the conservative stale-payload rejection with a current base', async () => {
    remote(stored());
    const input = task({ baseRevision: 7 });
    input.payload = record(earlier);
    const before = structuredClone(input);
    await expect(run(input)).rejects.toThrow(/newer/);
    expect(input).toEqual(before);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it('preserves a disjoint remote edit while replaying a granular stale task', async () => {
    remote(
      stored({
        nurses: ['SINTETICA REMOTA', 'SINTETICA REMOTA 2'],
        nursesDayShift: ['SINTETICA REMOTA', 'SINTETICA REMOTA 2'],
      })
    );
    const input = task({
      changedPaths: ['tensDayShift'],
      expectedVersion: earlier,
      baseRevision: 6,
    });
    input.payload = record(earlier);

    const expected = {
      nursesDayShift: ['SINTETICA REMOTA', 'SINTETICA REMOTA 2'],
      tensDayShift: ['SINTETICO B', '', ''],
    };
    await expect(run(input)).resolves.toMatchObject({ authoritativeRecord: expected });
    const published =
      lane === 'direct' ? mocks.set.mock.calls[0][1] : mocks.callable.mock.calls[0][0].record;
    expect(published).toMatchObject(expected);
  });
});

describe('direct full-save transaction base', () => {
  it.each([
    ['changed revision at the same timestamp', stored({ meta: { revision: 8 } })],
    ['timestamp ahead with unchanged revision', stored({ lastUpdated: later })],
    ['timestamp behind with unchanged revision', stored({ lastUpdated: earlier })],
  ])('revalidates %s after preflight', async (_label, changed) => {
    remote(stored());
    mocks.transactionRead.mockResolvedValue(snapshot(changed));
    const input = task({ baseRevision: 7 });
    const before = structuredClone(input);

    await expect(run(input)).rejects.toMatchObject({
      name: 'ConcurrencyError',
      reason: 'semantic_conflict',
    });

    expect(input).toEqual(before);
    expect(mocks.transactionRead).toHaveBeenCalledOnce();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('revalidates the original base on every SDK retry without adopting the fresh read', async () => {
    remote(stored());
    const input = task({ baseRevision: 7 });
    const before = structuredClone(input);
    mocks.transaction.mockImplementation(async (_db, callback) => {
      await callback(tx());
      expect(mocks.set).toHaveBeenCalledOnce();
      expect(mocks.set.mock.calls[0][1]).toMatchObject(record());
      mocks.set.mockClear();
      mocks.transactionRead.mockResolvedValue(snapshot(stored({ lastUpdated: later })));
      return callback(tx());
    });

    await expect(run(input)).rejects.toBeInstanceOf(ConcurrencyError);

    expect(input).toEqual(before);
    expect(mocks.transactionRead).toHaveBeenCalledTimes(2);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.callable).not.toHaveBeenCalled();
  });

  it('does not manufacture a base when another writer creates the absent day', async () => {
    mocks.transactionRead.mockResolvedValue(snapshot(stored()));
    await expect(run(task({ expectedVersion: '' }))).rejects.toMatchObject({
      reason: 'semantic_conflict',
    });
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
