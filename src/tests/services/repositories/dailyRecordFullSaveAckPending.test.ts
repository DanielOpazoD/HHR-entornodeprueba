import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { saveRecordToFirestore } from '@/services/storage/firestore/firestoreRecordWrites';

const remote = vi.hoisted(() => ({ save: vi.fn<typeof saveRecordToFirestore>(), read: vi.fn() }));
vi.mock('@/services/storage/firestore/firestoreRecordWrites', () => ({
  saveRecordToFirestore: remote.save,
  updateRecordPartial: vi.fn(),
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', () => ({
  getRecordFromFirestore: remote.read,
}));
vi.mock('@/services/repositories/repositoryConfig', () => ({ isFirestoreEnabled: () => true }));
vi.mock('@/services/repositories/PatientMasterRepository', () => ({
  PatientMasterRepository: { upsertPatient: vi.fn() },
}));
vi.mock('@/services/utils/fhirMappers', () => ({ mapPatientToFhir: vi.fn(() => ({})) }));

import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { saveDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { queueDailyRecordSyncTaskWithLocalRecord } from '@/services/storage/sync';

const date = '2026-10-27';
const localRecord = async () => {
  const record = await hospitalDB.dailyRecords.get(date);
  if (!record) throw new Error('Missing synthetic projection');
  return record;
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
};
const beginSave = async (requireConfirmedRecord = true) => {
  const base = DataFactory.createMockDailyRecord(date, {
    beds: {},
    lastUpdated: `${date}T10:00:00.000Z`,
    nursesDayShift: ['SYNTHETIC BASE'],
    tensDayShift: ['SYNTHETIC BASE'],
  });
  await hospitalDB.dailyRecords.put(base);
  const entered = deferred<void>();
  const response = deferred<Awaited<ReturnType<typeof saveRecordToFirestore>>>();
  remote.save.mockImplementation(() => {
    entered.resolve();
    return response.promise;
  });
  const request = saveDetailed({ ...base, nursesDayShift: ['SYNTHETIC A'] }, base.lastUpdated, {
    baseRecord: base,
    requireConfirmedRecord,
  });
  await entered.promise;
  const sent = await localRecord();
  const confirmed: DailyRecord = {
    ...sent,
    nursesDayShift: ['SYNTHETIC A NORMALIZED'],
    lastUpdated: `${date}T14:00:00.000Z`,
  };
  return {
    sent,
    confirmed,
    request,
    finishWithoutReceipt: () => response.resolve(undefined),
    finish: () =>
      response.resolve({
        recordState: {
          record: confirmed,
          lastUpdated: confirmed.lastUpdated,
          meta: { revision: 1 },
        },
      }),
  };
};

describe('confirmed local-first full save with a pending projection', () => {
  beforeEach(async () => {
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
    localStorage.clear();
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    remote.save.mockReset();
    remote.read.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it('adopts the exact normalized remote A when A is the only pending write', async () => {
    const { confirmed, finish, request } = await beginSave();
    finish();
    const result = await request;
    expect(result).toMatchObject({
      savedRemotely: true,
      savedLocally: true,
      confirmedRecord: confirmed,
    });
    expect(result.localProjectionRecord).toBeUndefined();
    expect(await localRecord()).toEqual(confirmed);
    expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
  });

  it('reconciles the confirmed server readback when the write returns no receipt', async () => {
    const { confirmed, finishWithoutReceipt, request } = await beginSave();
    remote.read.mockResolvedValue(confirmed);
    finishWithoutReceipt();
    expect(await request).toMatchObject({
      savedRemotely: true,
      savedLocally: true,
      confirmedRecord: confirmed,
    });
    expect(await localRecord()).toEqual(confirmed);
    expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
  });

  it('keeps the existing void-response path when no confirmed record is requested', async () => {
    const { sent, finishWithoutReceipt, request } = await beginSave(false);
    finishWithoutReceipt();
    const result = await request;
    expect(result).toMatchObject({ savedRemotely: true, savedLocally: true });
    expect(result.confirmedRecord).toBeUndefined();
    expect(await localRecord()).toEqual(sent);
    expect(await hospitalDB.syncQueue.toArray()).toEqual([]);
  });

  it('returns A as confirmed while retaining compacted B and its original replay intent', async () => {
    const { sent, confirmed, finish, request } = await beginSave();
    const later = { ...sent, tensDayShift: ['SYNTHETIC B'] };
    await queueDailyRecordSyncTaskWithLocalRecord(
      later,
      {
        syncContract: {
          expectedVersion: sent.lastUpdated,
          changedPaths: ['tensDayShift'],
          mutationId: 'synthetic-b',
        },
      },
      { wholeRecordBase: sent }
    );
    const tasksBefore = await hospitalDB.syncQueue.toArray();
    finish();
    const result = await request;
    expect(result).toMatchObject({
      savedRemotely: true,
      savedLocally: true,
      confirmedRecord: confirmed,
      localProjectionRecord: later,
    });
    expect(await localRecord()).toEqual(later);
    expect(await hospitalDB.syncQueue.toArray()).toEqual(tasksBefore);
  });

  it('exposes local reconciliation failure without denying the remote commit or falling back', async () => {
    const { sent, confirmed, finish, request } = await beginSave();
    const before = await hospitalDB.syncQueue.toArray();
    vi.spyOn(hospitalDB.syncQueue, 'delete').mockRejectedValueOnce(
      new Error('Synthetic ACK delete failure')
    );
    finish();
    const result = await request;
    expect(result).toMatchObject({
      savedRemotely: true,
      savedLocally: false,
      outcome: 'unrecoverable',
      confirmedRecord: confirmed,
    });
    expect(await localRecord()).toEqual(sent);
    expect(await hospitalDB.syncQueue.toArray()).toMatchObject(
      before.map(task => ({
        id: task.id,
        payload: task.payload,
        syncContract: task.syncContract,
        status: task.status,
      }))
    );
    expect(localStorage.getItem(`hhr_daily_record_${date}`)).toBeNull();
  });
});
