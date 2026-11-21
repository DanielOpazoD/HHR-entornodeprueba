// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import { updateRecordPartial } from '@/services/storage/firestore/firestoreRecordWrites';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const mocks = vi.hoisted(() => ({ reads: [] as string[], patch: vi.fn(), save: vi.fn() }));
// Every read names its document, so the Rayen policy (settings/rayenImportPolicy) can be counted.
vi.mock('firebase/firestore', async original => {
  const actual = await original<typeof import('firebase/firestore')>();
  const join = (...parts: unknown[]) =>
    parts
      .map(part => (typeof part === 'string' ? part : (part as { path?: string })?.path))
      .filter(Boolean)
      .join('/');
  return {
    ...actual,
    doc: (...parts: unknown[]) => ({ path: join(...parts) }),
    collection: (...parts: unknown[]) => ({ path: join(...parts) }),
    getDoc: async (ref: { path: string }) => {
      mocks.reads.push(ref.path);
      return ref.path.endsWith('rayenImportPolicy')
        ? { exists: () => true, data: () => ({ schemaVersion: 2 }) }
        : { exists: () => false, data: () => undefined };
    },
  };
});
vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: {
    ready: Promise.resolve(),
    getCurrentUser: () => ({ uid: 'synthetic-nurse', isAnonymous: false }),
  },
}));
vi.mock('@/services/storage/firestore/firestoreServiceRuntime', () => ({
  defaultFirestoreServiceRuntime: { getDb: () => ({}), ready: Promise.resolve() },
}));
vi.mock('@/services/storage/firestore/dailyRecordAuthorityCallableClient', async original => ({
  ...(await original<
    typeof import('@/services/storage/firestore/dailyRecordAuthorityCallableClient')
  >()),
  patchDailyRecordWithClinicalAuthorityCallable: mocks.patch,
  saveDailyRecordWithClinicalAuthorityCallable: mocks.save,
}));

const date = '2026-11-20';
const SAVES = 5;
const policyReads = () => mocks.reads.filter(path => path.endsWith('rayenImportPolicy')).length;
const day = () =>
  DataFactory.createMockDailyRecord(date, {
    beds: { R1: DataFactory.createMockPatient('R1', { age: '40' }) },
    lastUpdated: `${date}T10:00:00.000Z`,
  });

beforeEach(() => {
  mocks.reads.length = 0;
  mocks.patch.mockResolvedValue({ success: true });
  mocks.save.mockImplementation(async ({ record }) => ({
    success: true,
    recordState: { record, lastUpdated: record.lastUpdated, meta: {} },
  }));
});

it('saves a bed field without reading the Rayen policy, however many times', async () => {
  for (let index = 0; index < SAVES; index += 1) {
    await updateRecordPartial(date, { 'beds.R1.age': `${41 + index}` }, `${date}T10:00:00.000Z`);
  }
  expect(mocks.patch).toHaveBeenCalledTimes(SAVES);
  expect(policyReads()).toBe(0);
});

it('resends queued days without reading the Rayen policy', async () => {
  const transport = createFirestoreSyncTransport({
    getDb: () => ({}) as Firestore,
    ready: Promise.resolve(),
  });
  for (let index = 0; index < SAVES; index += 1) {
    const task: SyncTask = {
      opId: `synthetic-op-${index}`,
      type: 'UPDATE_DAILY_RECORD',
      payload: day(),
      timestamp: index,
      retryCount: 0,
      status: 'PENDING',
      syncContract: { changedPaths: ['beds.R1.age'], mutationId: `synthetic-mutation-${index}` },
    };
    await transport.run(task);
  }
  expect(mocks.save).toHaveBeenCalledTimes(SAVES);
  expect(policyReads()).toBe(0);
});
