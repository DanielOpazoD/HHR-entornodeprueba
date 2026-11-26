// @vitest-environment node
import { captureAuthoringSession } from '@/services/session/authoringSession';
import { getForDateWithMeta } from '@/services/repositories/dailyRecordRepositoryReadService';
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const { firestoreEnabled, loadRemote, subscriptionCallbacks } = vi.hoisted(() => ({
  firestoreEnabled: { value: false },
  loadRemote: vi.fn(),
  subscriptionCallbacks: [] as Array<
    (
      record: DailyRecord | null,
      pending: boolean,
      metadata: { fromCache: boolean; hasPendingWrites: boolean }
    ) => void
  >,
}));
vi.mock('@/services/repositories/repositoryConfig', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/repositories/repositoryConfig')>()),
  isFirestoreEnabled: () => firestoreEnabled.value,
}));
vi.mock('@/services/repositories/dailyRecordRemoteLoader', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/repositories/dailyRecordRemoteLoader')>()),
  loadRemoteRecordWithFallback: loadRemote,
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  subscribeToRecord: (
    _date: string,
    callback: (
      record: DailyRecord | null,
      pending: boolean,
      metadata: { fromCache: boolean; hasPendingWrites: boolean }
    ) => void
  ) => {
    subscriptionCallbacks.push(callback);
    return () => {};
  },
}));
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { queueDailyRecordSyncTaskWithLocalRecord } from '@/services/storage/sync';
import { resolveRemoteGoldenPathReadResult } from '@/services/repositories/dailyRecordRemoteReadController';
import { subscribeDetailed } from '@/services/repositories/dailyRecordRepositorySyncService';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecordReadResult } from '@/services/repositories/contracts/dailyRecordQueries';

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
  serverConfirmed: true,
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
    await queueDailyRecordSyncTaskWithLocalRecord(pendingEdit(), undefined, {
      authoringSession: captureAuthoringSession(),
    });

    const result = await resolveRemoteGoldenPathReadResult({
      date,
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
    await queueDailyRecordSyncTaskWithLocalRecord(pendingEdit(), undefined, {
      authoringSession: captureAuthoringSession(),
    });
    loadRemote.mockResolvedValue(remoteLoad(newerRemote()));

    const result = await getForDateWithMeta(date, true);

    expect(result?.record?.tensDayShift).toEqual(['SINTETICO PENDIENTE']);
    expect(result?.consistencyState).toBe('local_authoritative');
    expect(result?.sourceOfTruth).toBe('local');
  });

  it('a realtime snapshot keeps the pending edit instead of the newer remote copy', async () => {
    await queueDailyRecordSyncTaskWithLocalRecord(pendingEdit(), undefined, {
      authoringSession: captureAuthoringSession(),
    });
    const published = new Promise<DailyRecordReadResult>(resolve => {
      subscribeDetailed(date, result => resolve(result));
    });

    subscriptionCallbacks[0](newerRemote(), false, { fromCache: false, hasPendingWrites: false });
    const result = await published;

    expect(result.record?.tensDayShift).toEqual(['SINTETICO PENDIENTE']);
    expect(result.consistencyState).toBe('local_authoritative');
    expect(result.sourceOfTruth).toBe('local');
  });
});

describe('a read never publishes another copy over a pending local edit', () => {
  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
    localStorage.clear();
    firestoreEnabled.value = false;
    loadRemote.mockReset();
    subscriptionCallbacks.length = 0;
  });

  it('keeps the pending edit when the remote copy carries the same version time', async () => {
    const localBeforeRead = base();
    await hospitalDB.dailyRecords.put(localBeforeRead);
    await queueDailyRecordSyncTaskWithLocalRecord(
      {
        ...pendingEdit(),
        lastUpdated: newerRemote().lastUpdated,
      },
      undefined,
      { authoringSession: captureAuthoringSession() }
    );

    const result = await resolveRemoteGoldenPathReadResult({
      date,
      remoteReadResult: remoteLoad(newerRemote()),
    });

    expect((await hospitalDB.dailyRecords.get(date))?.tensDayShift).toEqual([
      'SINTETICO PENDIENTE',
    ]);
    expect(result.record?.tensDayShift).toEqual(['SINTETICO PENDIENTE']);
    expect(result.sourceOfTruth).toBe('local');
  });

  it('a manual sync publishes an edit saved while the remote read was in flight', async () => {
    firestoreEnabled.value = true;
    await hospitalDB.dailyRecords.put(base());
    loadRemote.mockImplementation(async () => {
      await queueDailyRecordSyncTaskWithLocalRecord(pendingEdit(), undefined, {
        authoringSession: captureAuthoringSession(),
      });
      return remoteLoad(base());
    });

    const result = await getForDateWithMeta(date, true);

    expect((await hospitalDB.dailyRecords.get(date))?.tensDayShift).toEqual([
      'SINTETICO PENDIENTE',
    ]);
    expect(result?.record?.tensDayShift).toEqual(['SINTETICO PENDIENTE']);
    expect(result?.sourceOfTruth).toBe('local');
  });

  it('a read that finds no remote copy publishes the pending edit saved meanwhile', async () => {
    const localBeforeRead = base();
    await hospitalDB.dailyRecords.put(localBeforeRead);
    await queueDailyRecordSyncTaskWithLocalRecord(pendingEdit(), undefined, {
      authoringSession: captureAuthoringSession(),
    });

    const result = await resolveRemoteGoldenPathReadResult({
      date,
      remoteReadResult: { ...remoteLoad(base()), record: null },
    });

    expect(result.record?.tensDayShift).toEqual(['SINTETICO PENDIENTE']);
    expect(result.sourceOfTruth).toBe('local');
  });

  it('a manual sync with a missing remote keeps the in-flight edit', async () => {
    firestoreEnabled.value = true;
    await hospitalDB.dailyRecords.put(base());
    loadRemote.mockImplementation(async () => {
      await queueDailyRecordSyncTaskWithLocalRecord(pendingEdit(), undefined, {
        authoringSession: captureAuthoringSession(),
      });
      return { ...remoteLoad(base()), record: null };
    });

    const result = await getForDateWithMeta(date, true);

    expect(result?.record).toEqual(await hospitalDB.dailyRecords.get(date));
    expect(result?.record?.tensDayShift).toEqual(['SINTETICO PENDIENTE']);
    expect(result?.sourceOfTruth).toBe('local');
    expect(result?.serverConfirmed).toBe(true);
    expect(result?.consistencyState).toBe('local_authoritative');
  });
});

it('a missing read cannot confirm a row replaced during the request without a holder', async () => {
  firestoreEnabled.value = true;
  await hospitalDB.syncQueue.clear();
  await hospitalDB.dailyRecords.put(base());
  loadRemote.mockImplementation(async () => {
    await hospitalDB.dailyRecords.put(pendingEdit());
    return { ...remoteLoad(base()), record: null };
  });
  const result = await getForDateWithMeta(date, true);
  expect(result).toMatchObject({
    serverConfirmed: false,
    publication: 'superseded',
  });
  expect(result?.record).toEqual(await hospitalDB.dailyRecords.get(date));
});
