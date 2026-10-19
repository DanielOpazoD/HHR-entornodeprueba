import { beforeEach, expect, it, vi } from 'vitest';
import type { Firestore, Transaction } from 'firebase/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  transaction: vi.fn(),
  set: vi.fn(),
  directSet: vi.fn(),
  transactionRead: vi.fn(),
  callable: vi.fn(),
  mode: 'client_only',
  fence: false,
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
  isServerClinicalWriteFenceActive: async () => mocks.fence,
}));
vi.mock('@/services/storage/firestore/dailyRecordAuthorityCallableClient', () => ({
  saveDailyRecordWithClinicalAuthorityCallable: mocks.callable,
}));
const date = '2026-07-17';
const record = (lastUpdated: string) =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    lastUpdated,
  });
const local = () => record(date + 'T10:00:00Z');
const missing = () => ({ exists: () => false });
const snapshot = (data: unknown) => ({ exists: () => true, data: () => data });
const tx = () => ({ get: mocks.transactionRead, set: mocks.set }) as unknown as Transaction;
const task = (): SyncTask => ({
  opId: 'synthetic-op',
  type: 'UPDATE_DAILY_RECORD',
  payload: local(),
  timestamp: 1,
  retryCount: 0,
  status: 'PENDING',
});
const run = (input = task()) =>
  createFirestoreSyncTransport({
    getDb: () => ({}) as Firestore,
    ready: Promise.resolve(),
  }).run(input);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.mode = 'client_only';
  mocks.fence = false;
  mocks.read.mockResolvedValue(missing());
  mocks.transactionRead.mockResolvedValue(missing());
  mocks.transaction.mockImplementation(async (_db, callback) => callback(tx()));
});
it('revalidates a concurrent write that appeared after the initial read', async () => {
  mocks.transactionRead.mockResolvedValue(snapshot(record(date + 'T10:01:00Z')));
  await expect(run()).rejects.toThrow(/newer/);
  expect(mocks.transaction).toHaveBeenCalledOnce();
  expect(mocks.set).not.toHaveBeenCalled();
  expect(mocks.directSet).not.toHaveBeenCalled();
});
it('revalidates the original intent when Firestore retries the callback', async () => {
  mocks.transaction.mockImplementation(async (_db, callback) => {
    await callback(tx()); // SDK discards this candidate when its read version loses the race.
    mocks.set.mockClear();
    mocks.transactionRead.mockResolvedValue(snapshot(record(date + 'T10:01:00Z')));
    return callback(tx());
  });
  await expect(run()).rejects.toThrow(/newer/);
  expect(mocks.transactionRead).toHaveBeenCalledTimes(2);
  expect(mocks.set).not.toHaveBeenCalled();
});
it('returns the committed record and never performs an unguarded setDoc', async () => {
  const outcome = await run();
  expect(outcome).toMatchObject({ authoritativeRecord: local() });
  expect(mocks.set).toHaveBeenCalledOnce();
  expect(mocks.directSet).not.toHaveBeenCalled();
});
it('recognizes an already applied mutation inside the transaction without writing again', async () => {
  const applied = { ...local(), meta: { lastMutationId: 'synthetic-mutation' } };
  mocks.transactionRead.mockResolvedValue(snapshot(applied));
  await run({ ...task(), syncContract: { mutationId: 'synthetic-mutation' } });
  expect(mocks.set).not.toHaveBeenCalled();
});
it.each(['enforced', 'fenced'])('retains the authoritative callable route for %s', async mode => {
  mocks.mode = mode === 'enforced' ? 'enforced' : 'client_only';
  mocks.fence = mode === 'fenced';
  mocks.callable.mockResolvedValue({
    recordState: { record: local(), lastUpdated: local().lastUpdated },
  });
  await expect(run()).resolves.toMatchObject({ authoritativeRecord: local() });
  expect(mocks.callable).toHaveBeenCalledOnce();
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.directSet).not.toHaveBeenCalled();
});
