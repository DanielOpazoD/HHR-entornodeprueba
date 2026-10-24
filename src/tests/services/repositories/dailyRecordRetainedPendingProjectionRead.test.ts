import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const { firestoreEnabled, loadRemote, subscriptionCallbacks } = vi.hoisted(() => ({
  firestoreEnabled: { value: false },
  loadRemote: vi.fn(),
  subscriptionCallbacks: [] as Array<(record: DailyRecord | null, pending: boolean) => void>,
}));
vi.mock('@/services/repositories/repositoryConfig', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/repositories/repositoryConfig')>()),
  isFirestoreEnabled: () => firestoreEnabled.value,
}));
vi.mock('@/services/repositories/dailyRecordRemoteLoader', () => ({
  loadRemoteRecordWithFallback: loadRemote,
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  subscribeToRecord: (
    _date: string,
    callback: (record: DailyRecord | null, pending: boolean) => void
  ) => {
    subscriptionCallbacks.push(callback);
    return () => {};
  },
}));
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { queueDailyRecordSyncTaskWithLocalRecord } from '@/services/storage/sync';
import { resolveRemoteGoldenPathReadResult } from '@/services/repositories/dailyRecordRemoteReadController';
import { createLocalRuntimeReadCandidate } from '@/services/repositories/dailyRecordReadResultController';
import {
  subscribeDetailed,
  syncWithFirestoreDetailed,
} from '@/services/repositories/dailyRecordRepositorySyncService';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { SyncDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';

const date = '2026-10-24';
const base = (): DailyRecord =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    lastUpdated: '2026-10-24T10:00:00.000Z',
    tensDayShift: ['SINTETICO BASE'],
  });
const pendingEdit = (): DailyRecord => ({
  ...base(),
  lastUpdated: '2026-10-24T10:01:00.000Z',
  tensDayShift: ['SINTETICO PENDIENTE'],
});
const newerRemote = (): DailyRecord => ({ ...base(), lastUpdated: '2026-10-24T10:02:00.000Z' });
const remoteLoad = (record: DailyRecord) => ({
  record,
  source: 'firestore' as const,
  compatibilityTier: 'current_firestore' as const,
  compatibilityIntensity: 'none' as const,
  migrationRulesApplied: [],
  cachedLocally: false,
});

describe('a read that meets a pending local edit publishes the retained projection', () => {
  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
    localStorage.clear();
    firestoreEnabled.value = false;
    loadRemote.mockReset();
    subscriptionCallbacks.length = 0;
  });

  it('publishes the pending edit that appeared while the remote read was in flight', async () => {
    const localBeforeRead = base();
    await hospitalDB.dailyRecords.put(localBeforeRead);
    await queueDailyRecordSyncTaskWithLocalRecord(pendingEdit());

    const result = await resolveRemoteGoldenPathReadResult({
      date,
      localCandidate: createLocalRuntimeReadCandidate(date, localBeforeRead),
      remoteReadResult: remoteLoad(newerRemote()),
    });

    expect((await hospitalDB.dailyRecords.get(date))?.tensDayShift).toEqual([
      'SINTETICO PENDIENTE',
    ]);
    expect(result.record?.tensDayShift).toEqual(['SINTETICO PENDIENTE']);
    expect(result.record?.lastUpdated).toBe(pendingEdit().lastUpdated);
    expect(result.source).toBe('indexeddb');
    expect(result.sourceOfTruth).toBe('local');
  });

  it('a manual sync keeps the pending edit instead of the newer remote copy', async () => {
    firestoreEnabled.value = true;
    await queueDailyRecordSyncTaskWithLocalRecord(pendingEdit());
    loadRemote.mockResolvedValue(remoteLoad(newerRemote()));

    const result = await syncWithFirestoreDetailed(date);

    expect(result?.record?.tensDayShift).toEqual(['SINTETICO PENDIENTE']);
    expect(result?.consistencyState).toBe('local_kept');
    expect(result?.sourceOfTruth).toBe('local');
  });

  it('a realtime snapshot keeps the pending edit instead of the newer remote copy', async () => {
    await queueDailyRecordSyncTaskWithLocalRecord(pendingEdit());
    const published = new Promise<SyncDailyRecordResult>(resolve => {
      subscribeDetailed(date, result => resolve(result));
    });

    subscriptionCallbacks[0](newerRemote(), false);
    const result = await published;

    expect(result.record?.tensDayShift).toEqual(['SINTETICO PENDIENTE']);
    expect(result.consistencyState).toBe('local_kept');
    expect(result.sourceOfTruth).toBe('local');
  });
});
