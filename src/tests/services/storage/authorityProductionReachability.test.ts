import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const mocks = vi.hoisted(() => ({
  policyRead: vi.fn(),
  readback: vi.fn(),
  invoke: vi.fn(),
  directSave: vi.fn(),
  directPatch: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('firebase/firestore', async original => ({
  ...(await original<typeof import('firebase/firestore')>()),
  doc: (_db: unknown, path: string) => ({ path }),
  getDoc: (ref: { path?: string }) =>
    ref.path ? mocks.policyRead() : Promise.resolve({ exists: () => false }),
  getDocFromServer: mocks.readback,
  runTransaction: mocks.transaction,
  updateDoc: mocks.directPatch,
  setDoc: mocks.directSave,
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => mocks.invoke }));
vi.mock('@/services/firebase-runtime/functionsRuntime', () => ({
  defaultFunctionsRuntime: { getRegionalFunctions: async () => ({}) },
}));
vi.mock('@/services/firebase-runtime/authRuntime', () => ({
  defaultAuthRuntime: {
    ready: Promise.resolve(),
    getCurrentUser: () => ({ uid: 'synthetic-nurse', isAnonymous: false }),
  },
}));
vi.mock('@/services/storage/firestore/firestoreShared', async original => ({
  ...(await original<typeof import('@/services/storage/firestore/firestoreShared')>()),
  getRecordDocRef: (date: string) => ({ date }),
}));
vi.mock('@/services/storage/firestore/firestoreWriteSupport', async original => ({
  ...(await original<typeof import('@/services/storage/firestore/firestoreWriteSupport')>()),
  saveRecordAtomically: mocks.directSave,
}));

import {
  saveRecordToFirestore,
  updateRecordPartial,
} from '@/services/storage/firestore/firestoreRecordWrites';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';

const date = '2026-11-01';
const mutationId = 'synthetic-authority-fallback';
const syncContract = { mutationId, changedPaths: ['*'] };
const record = () => DataFactory.createMockDailyRecord(date, { beds: {} });
const committed = () => ({
  ...record(),
  lastUpdated: `${date}T12:00:00.000Z`,
  meta: { revision: 2, lastMutationId: mutationId },
  cudyrLocked: true,
});

describe('production authority fallback after a transient policy read failure', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_MODE', undefined);
    vi.stubEnv('VITE_DAILY_RECORD_AUTHORITY_CALLABLE', undefined);
    mocks.policyRead
      .mockResolvedValue({
        exists: () => true,
        data: () => ({ schemaVersion: 2, clinicalBatchMode: 'enforced' }),
      })
      .mockRejectedValueOnce(new Error('Synthetic transient policy read failure'));
    mocks.invoke.mockResolvedValue({
      data: {
        success: true,
        mode: 'enforced',
        recordState: { record: committed(), lastUpdated: committed().lastUpdated },
      },
    });
    mocks.readback.mockResolvedValue({
      exists: () => true,
      metadata: { fromCache: false, hasPendingWrites: false },
      data: committed,
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  const cases = [
    {
      name: 'full save',
      origin: 'direct_save',
      run: () => saveRecordToFirestore(record(), undefined, { syncContract }),
    },
    {
      name: 'clinical bed patch',
      origin: 'direct_partial_update',
      run: () =>
        updateRecordPartial(date, { 'beds.R1.pathology': 'Sintético' }, undefined, {
          syncContract: { mutationId, changedPaths: ['beds.R1.pathology'] },
        }),
    },
    {
      name: 'structural bed patch',
      origin: 'direct_partial_update',
      run: () =>
        updateRecordPartial(date, { 'beds.R1.patientName': 'Paciente sintético' }, undefined, {
          syncContract: { mutationId, changedPaths: ['beds.R1.patientName'] },
        }),
    },
    {
      name: 'sync publication',
      origin: 'full_save_retry',
      run: () => {
        const task: SyncTask = {
          id: 1,
          opId: mutationId,
          key: `daily:${date}`,
          type: 'UPDATE_DAILY_RECORD',
          payload: record(),
          timestamp: 1,
          retryCount: 0,
          status: 'PENDING',
          origin: 'full_save_retry',
          syncContract,
        };
        return createFirestoreSyncTransport({
          getDb: () => ({}) as Firestore,
          ready: Promise.resolve(),
        }).run(task);
      },
    },
  ];

  describe.each(cases)('$name', ({ run, origin }) => {
    it.each([false, true])('uses enforced and recovers a lost response: %s', async lost => {
      if (lost) {
        mocks.invoke.mockRejectedValueOnce(
          Object.assign(new Error('Synthetic lost response'), { code: 'functions/unavailable' })
        );
      }

      const result = await run();

      expect(mocks.policyRead.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          mode: 'enforced',
          origin,
          syncContract: expect.objectContaining({ mutationId }),
        })
      );
      expect(mocks.invoke.mock.calls[0][0]).not.toHaveProperty('dryRun');
      expect(mocks.readback).toHaveBeenCalledTimes(lost ? 1 : 0);
      if (lost) {
        expect(mocks.readback).toHaveBeenCalledWith({ date });
        expect(result).toMatchObject(
          origin === 'full_save_retry'
            ? { authoritativeRecord: { meta: committed().meta, cudyrLocked: true } }
            : {
                success: true,
                mutationId,
                recordState: { record: { meta: committed().meta, cudyrLocked: true } },
              }
        );
      }
      expect(mocks.directSave).not.toHaveBeenCalled();
      expect(mocks.directPatch).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    });
  });
});
