import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordPatch } from '@/types/domain/dailyRecordPatch';

const remote = vi.hoisted(() => ({
  enabled: false,
  record: null as DailyRecord | null,
  writePatch: vi.fn(),
}));
vi.mock('@/services/repositories/repositoryConfig', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/repositories/repositoryConfig')>()),
  isFirestoreEnabled: () => remote.enabled,
}));
vi.mock('@/services/storage/firestore/firestoreRecordWrites', () => ({
  updateRecordPartial: remote.writePatch,
  saveRecordToFirestore: vi.fn(),
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  getRecordFromFirestore: async () => remote.record,
}));

import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import { updatePartialDetailed } from '@/services/repositories/dailyRecordRepositoryWriteService';
import { DataFactory } from '@/tests/factories/DataFactory';
import { applyPatches } from '@/utils/patchUtils';

const date = '2026-10-24';
const baseRecord = (): DailyRecord =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    lastUpdated: '2026-10-24T10:00:00.000Z',
    nursesDayShift: ['SINTETICA BASE'],
    tensDayShift: ['SINTETICO BASE'],
  });
const readPath = (source: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined,
      source
    );
const localRecord = async (): Promise<DailyRecord> => {
  const record = await hospitalDB.dailyRecords.get(date);
  if (!record) throw new Error('missing synthetic local record');
  return record;
};
const offline = () =>
  Object.assign(new Error('synthetic network failure'), { code: 'unavailable' });

/** The queue publishes each task's changed paths onto the synthetic remote day. */
const publishQueue = async (): Promise<void> => {
  const engine = createSyncQueueEngine({
    store: createDexieSyncQueueStore(),
    runtime: { isOnline: () => true, getOwnerKey: () => null, onOnline: () => {} },
    transport: {
      run: async task => {
        const payload = task.payload as DailyRecord;
        const patch: DailyRecordPatch = {};
        (task.syncContract?.changedPaths ?? []).forEach(path => {
          patch[path] = readPath(payload, path);
        });
        remote.record = {
          ...applyPatches(remote.record!, patch),
          lastUpdated: payload.lastUpdated,
        };
        return { authoritativeRecord: remote.record };
      },
    },
    batchSize: 8,
    maxPendingTasks: 192,
    maxRetries: 5,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30000,
  });
  vi.setSystemTime(new Date('2026-10-24T15:00:00.000Z'));
  await engine.processQueue();
};

describe('a direct write acknowledges only its own edit', () => {
  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
    localStorage.clear();
    // The module queue stays idle; each test publishes with its own synthetic transport.
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-24T12:00:00.000Z'));
    remote.enabled = true;
    remote.record = baseRecord();
    remote.writePatch.mockReset();
    remote.writePatch.mockImplementation(async (_date: string, patch: DailyRecordPatch) => {
      remote.record = applyPatches(remote.record!, patch);
    });
    await hospitalDB.dailyRecords.put(baseRecord());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('an edit saved offline still reaches the remote after a later edit is written directly', async () => {
    remote.writePatch.mockRejectedValueOnce(offline());
    const offlineEdit = await updatePartialDetailed(
      date,
      { nursesDayShift: ['SINTETICA SIN RED'] },
      { baseRecord: baseRecord() }
    );
    expect(offlineEdit.savedLocally).toBe(true);
    expect(remote.record?.nursesDayShift).toEqual(['SINTETICA BASE']);

    vi.setSystemTime(new Date('2026-10-24T13:00:00.000Z'));
    await updatePartialDetailed(
      date,
      { tensDayShift: ['SINTETICO CON RED'] },
      { baseRecord: await localRecord() }
    );

    expect(remote.record?.tensDayShift).toEqual(['SINTETICO CON RED']);
    expect(await hospitalDB.syncQueue.count()).toBe(1);
    await publishQueue();
    expect(remote.record?.nursesDayShift).toEqual(['SINTETICA SIN RED']);
    expect(remote.record?.tensDayShift).toEqual(['SINTETICO CON RED']);
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });

  it('an edit queued in another tab survives this tab writing directly from the same base', async () => {
    remote.enabled = false;
    await updatePartialDetailed(
      date,
      { nursesDayShift: ['SINTETICA OTRA PESTANA'] },
      { baseRecord: baseRecord() }
    );
    remote.enabled = true;
    vi.setSystemTime(new Date('2026-10-24T13:00:00.000Z'));
    await updatePartialDetailed(
      date,
      { tensDayShift: ['SINTETICO ESTA PESTANA'] },
      { baseRecord: baseRecord() }
    );

    expect((await localRecord()).nursesDayShift).toEqual(['SINTETICA OTRA PESTANA']);
    await publishQueue();
    expect(remote.record?.nursesDayShift).toEqual(['SINTETICA OTRA PESTANA']);
    expect(remote.record?.tensDayShift).toEqual(['SINTETICO ESTA PESTANA']);
  });

  it('a direct write with nothing else pending leaves no task behind', async () => {
    const result = await updatePartialDetailed(
      date,
      { tensDayShift: ['SINTETICO UNICO'] },
      { baseRecord: baseRecord() }
    );

    expect(result.savedLocally).toBe(true);
    expect(remote.record?.tensDayShift).toEqual(['SINTETICO UNICO']);
    expect(await hospitalDB.syncQueue.count()).toBe(0);
  });
});
