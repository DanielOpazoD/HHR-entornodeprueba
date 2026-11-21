// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecordAuthorityCallablePayload } from '@/services/storage/firestore/dailyRecordAuthorityCallableClient';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  transaction: vi.fn(),
  directSet: vi.fn(),
  directUpdate: vi.fn(),
  callable: vi.fn(),
  patch: vi.fn(),
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
vi.mock('@/services/storage/firestore/firestoreWriteSupport', async original => ({
  ...(await original<typeof import('@/services/storage/firestore/firestoreWriteSupport')>()),
  updateRecordPartiallyAtomically: mocks.directUpdate,
}));
vi.mock('@/services/storage/firestore/dailyRecordAuthorityCallableClient', () => ({
  saveDailyRecordWithClinicalAuthorityCallable: mocks.callable,
  patchDailyRecordWithClinicalAuthorityCallable: mocks.patch,
  shouldRetryDailyRecordAuthorityError: () => false,
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
  mocks.read.mockResolvedValue(missing());
  // The authority commits what it is sent.
  mocks.callable.mockImplementation(
    async ({ record: sent }: DailyRecordAuthorityCallablePayload) => ({
      recordState: { record: sent, lastUpdated: sent.lastUpdated },
    })
  );
  // A partial task resends as the same edit made online: the patch commits over the read day.
  mocks.patch.mockImplementation(async () => {
    const stored = (await mocks.read()).data();
    return { recordState: { record: stored, lastUpdated: stored.lastUpdated } };
  });
  // Staffing and day fields keep their direct write: it commits over the day it read.
  mocks.directUpdate.mockImplementation(async () => (await mocks.read()).data());
});
it('publishes through the authority callable, never a direct write', async () => {
  await expect(run()).resolves.toMatchObject({ authoritativeRecord: local() });
  expect(mocks.callable).toHaveBeenCalledOnce();
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.directSet).not.toHaveBeenCalled();
});
it('recognizes an already applied mutation without writing again', async () => {
  const applied = { ...local(), meta: { lastMutationId: 'synthetic-mutation' } };
  mocks.read.mockResolvedValue(snapshot(applied));
  await run({ ...task(), syncContract: { mutationId: 'synthetic-mutation' } });
  expect(mocks.callable).not.toHaveBeenCalled();
});

it.each(['unchanged', 'changed', 'same-clock', 'lost-ack'] as const)(
  'compares the queued field base with the stored day before publishing: %s',
  async scenario => {
    const base = {
      ...local(),
      beds: { R1: DataFactory.createMockPatient('R1', { pathology: 'BASE' }) },
    };
    const edited = { ...base, beds: { R1: { ...base.beds.R1, pathology: 'A OFFLINE' } } };
    const remote = {
      ...base,
      lastUpdated: scenario === 'same-clock' ? base.lastUpdated : date + 'T10:01:00Z',
      beds: { R1: { ...base.beds.R1, pathology: scenario === 'unchanged' ? 'BASE' : 'B ONLINE' } },
      ...(scenario === 'lost-ack' ? { meta: { lastMutationId: 'queued-edit' } } : {}),
    };
    mocks.read.mockResolvedValue(snapshot(remote));
    const input = {
      ...task(),
      payload: edited,
      patchBaseValues: { 'beds.R1.pathology': 'BASE' },
      syncContract: {
        mutationId: 'queued-edit',
        expectedVersion: base.lastUpdated,
        changedPaths: ['beds.R1.pathology'],
      },
    };
    if (scenario === 'changed' || scenario === 'same-clock') {
      await expect(run(input)).rejects.toMatchObject({ name: 'ConcurrencyError' });
      expect(mocks.patch).not.toHaveBeenCalled();
    } else {
      await run(input);
      if (scenario === 'lost-ack') expect(mocks.patch).not.toHaveBeenCalled();
      else
        expect(mocks.patch).toHaveBeenCalledWith(
          expect.objectContaining({
            patch: { 'beds.R1.pathology': 'A OFFLINE' },
            expectedLastUpdated: remote.lastUpdated,
          }),
          undefined
        );
    }
    expect(mocks.callable).not.toHaveBeenCalled();
  }
);

it.each([{ names: ['NURSE'] }, { names: ['NURSE', '', ''] }])(
  'preserves staffing replay when the captured base is %j',
  async ({ names }) => {
    const base = { ...local(), tensDayShift: names };
    const edited = { ...base, tensDayShift: ['EDITED'] };
    mocks.read.mockResolvedValue(
      snapshot({ ...base, tensDayShift: ['NURSE'], lastUpdated: date + 'T10:01:00Z' })
    );
    const outcome = await run({
      ...task(),
      payload: edited,
      patchBaseValues: { tensDayShift: names },
      syncContract: {
        mutationId: 'staffing-edit',
        expectedVersion: base.lastUpdated,
        changedPaths: ['tensDayShift'],
      },
    });
    expect(outcome).toMatchObject({
      authoritativeRecord: { tensDayShift: expect.arrayContaining(['EDITED']) },
    });
    // Staffing keeps its own direct write, over the day just read, as online.
    expect(mocks.directUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tensDayShift: ['EDITED'] }),
      date + 'T10:01:00Z',
      expect.any(String),
      'staffing update',
      expect.anything()
    );
    expect(mocks.callable).not.toHaveBeenCalled();
  }
);
