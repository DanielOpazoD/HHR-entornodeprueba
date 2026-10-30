import 'fake-indexeddb/auto';
import Dexie, { type DBCore, type Middleware } from 'dexie';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getSyncQueueTelemetry } from '@/services/storage/sync/publicSyncQueue';
import {
  getDiscardedDailyRecordBackup,
  listDiscardedDailyRecordTasks,
} from '@/services/storage/sync/dailyRecordTaskRetirement';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import {
  SESSION_GENERATION_KEY,
  setSessionGeneration,
} from '@/services/storage/sessionStorageTransition';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecord } from '@/types/domain/dailyRecord';

vi.mock('@/services/storage/indexeddb/indexedDbCore', async () => {
  const { HangaRoaDatabase } = await import('@/services/storage/indexeddb/indexedDbDatabase');
  const hospitalDB = new HangaRoaDatabase();
  return { hospitalDB, ensureDbReady: () => hospitalDB.open() };
});
vi.mock('@/services/storage/sync/browserSyncRuntime', async () => {
  const { getStoredSessionOwnerKey } = await import('@/services/storage/sessionOwnerKey');
  return {
    createBrowserSyncRuntime: () => ({
      getOwnerKey: getStoredSessionOwnerKey,
      isOnline: () => false,
      onOnline: () => {},
    }),
  };
});
vi.mock('@/services/storage/sync/firestoreSyncTransport', () => ({
  createFirestoreSyncTransport: () => ({ run: vi.fn() }),
}));

const NOW = Date.parse('2026-10-29T18:00:00.000Z');
const OWNERS = ['user:synthetic-owner-a', 'user:synthetic-owner-b', undefined, ''];
const enter = (owner: string) => {
  localStorage.setItem(SESSION_OWNER_KEY, owner);
  localStorage.setItem(SESSION_GENERATION_KEY, 'synthetic-materialization-generation');
  setSessionGeneration('synthetic-materialization-generation');
};
const observeValues = (db: Dexie) => {
  let enabled = false;
  let total = 0;
  let retired = 0;
  const observe = (value: unknown) => {
    if (!enabled || value === undefined) return;
    if (!value || typeof value !== 'object' || !('status' in value)) {
      throw new Error('Expected a synthetic queue value');
    }
    total += 1;
    if (value.status === 'RETIRED') retired += 1;
  };
  const middleware: Middleware<DBCore> = {
    stack: 'dbcore',
    name: 'synthetic-telemetry-values',
    level: -2,
    create: down => ({
      table(name) {
        const table = down.table(name);
        if (name !== 'syncQueue') return table;
        return {
          ...table,
          async query(request) {
            const response = await table.query(request);
            if (request.values) response.result.forEach(observe);
            return response;
          },
          async openCursor(request) {
            const cursor = await table.openCursor(request);
            if (!cursor || !request.values) return cursor;
            const start = cursor.start;
            cursor.start = callback =>
              start.call(cursor, () => {
                observe(cursor.value);
                callback();
              });
            return cursor;
          },
          async get(request) {
            const value = await table.get(request);
            observe(value);
            return value;
          },
          async getMany(request) {
            const values = await table.getMany(request);
            values.forEach(observe);
            return values;
          },
          mutate(request) {
            if (enabled) throw new Error('Telemetry must not write queue rows');
            return table.mutate(request);
          },
        };
      },
    }),
  };
  db.use(middleware);
  return async <T>(operation: () => Promise<T>) => {
    total = 0;
    retired = 0;
    enabled = true;
    try {
      const result = await operation();
      return { result, total, retired };
    } finally {
      enabled = false;
    }
  };
};

const task = (id: number, status: SyncTask['status'], ownerKey?: string): SyncTask => {
  const record: DailyRecord = {
    date: '2026-10-29',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    nurses: [],
    activeExtraBeds: [],
    lastUpdated: '2026-10-29T17:59:00.000Z',
    medicalHandoffNovedades: `synthetic-${id}:`.padEnd(4096, 'x'),
  };
  return {
    id,
    opId: `synthetic-materialization-${id}`,
    key: `daily:${record.date}`,
    type: 'UPDATE_DAILY_RECORD',
    payload: record,
    ownerKey,
    status,
    timestamp: NOW - 6000,
    retryCount: 0,
    ...(status === 'RETIRED'
      ? {
          retirement: {
            reason: 'manual_discard',
            retiredAt: '2026-10-29T17:59:00.000Z',
            previousStatus: 'FAILED',
          },
        }
      : {}),
  };
};
const retiredTask = (index: number) => ({
  ...task(1001 + index, 'RETIRED', OWNERS[index % OWNERS.length]),
  timestamp: index % 2 ? 1 : NOW + 60000,
  retryCount: index % 2 ? 999 : 0,
});
const fingerprint = async () =>
  createHash('sha256')
    .update(JSON.stringify(await hospitalDB.syncQueue.orderBy('id').toArray()))
    .digest('hex');

beforeAll(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Synthetic test forbids fetch')));
});
afterAll(() => {
  hospitalDB.close();
  localStorage.removeItem(SESSION_OWNER_KEY);
  localStorage.removeItem(SESSION_GENERATION_KEY);
  setSessionGeneration(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('observes actual values below Dexie caches and distinguishes key-only counts', async () => {
  const db = new Dexie('synthetic-telemetry-values-control');
  db.version(1).stores({ syncQueue: 'id,status' });
  const measure = observeValues(db);
  try {
    await db
      .table<SyncTask>('syncQueue')
      .bulkAdd([task(1, 'PENDING'), task(2, 'FAILED'), task(3, 'RETIRED')]);
    expect(await measure(() => db.table('syncQueue').toArray())).toMatchObject({
      total: 3,
      retired: 1,
    });
    const cursor = await measure(() =>
      db
        .table<SyncTask>('syncQueue')
        .filter(row => row.status === 'FAILED')
        .toArray()
    );
    expect(cursor.result).toHaveLength(1);
    expect(cursor).toMatchObject({ total: 3, retired: 1 });
    expect(
      await measure(() => db.table('syncQueue').where('status').equals('PENDING').count())
    ).toEqual({ result: 1, total: 0, retired: 0 });
  } finally {
    db.close();
  }
});

it('keeps polling work bounded while retired backups grow, survive reopening and remain downloadable', async () => {
  const measure = observeValues(hospitalDB);
  const states: SyncTask['status'][] = [
    'PENDING',
    'PENDING',
    'PENDING',
    'PROCESSING',
    'PROCESSING',
    'PROCESSING',
    'FAILED',
    'CONFLICT',
  ];
  await hospitalDB.syncQueue.bulkAdd(
    OWNERS.flatMap((owner, ownerIndex) =>
      states.map((status, index) => task(ownerIndex * states.length + index + 1, status, owner))
    )
  );
  let previousRetired = 0;
  let initialWork: number | undefined;
  for (const count of [0, 100, 1000]) {
    await hospitalDB.syncQueue.bulkAdd(
      Array.from({ length: count - previousRetired }, (_, index) =>
        retiredTask(previousRetired + index)
      )
    );
    previousRetired = count;
    enter('user:synthetic-owner-a');
    const before = await fingerprint();
    const poll = await measure(getSyncQueueTelemetry);
    expect(poll.result).toMatchObject({
      pending: 18,
      failed: 3,
      conflict: 3,
      retrying: 0,
      orphanedTasks: 8,
      readState: 'ok',
    });
    expect(poll.retired).toBe(0);
    expect(poll.total).toBeGreaterThan(0);
    expect(poll.total).toBeLessThanOrEqual(32);
    initialWork ??= poll.total;
    expect(poll.total).toBe(initialWork);
    expect(await fingerprint()).toBe(before);
    hospitalDB.close();
    await hospitalDB.open();
    expect(await fingerprint()).toBe(before);
    for (const owner of ['user:synthetic-owner-a', 'user:synthetic-owner-b']) {
      enter(owner);
      const backups = await listDiscardedDailyRecordTasks();
      expect(backups).toHaveLength(count / 4);
      for (const backup of backups) {
        if (backup.id === undefined) throw new Error('Backup must retain its primary key');
        expect(backup).toEqual(retiredTask(backup.id - 1001));
      }
      const first = backups[0];
      if (first?.id) {
        const download = await getDiscardedDailyRecordBackup(first.id);
        if (download === null) throw new Error('Backup must remain downloadable');
        expect(JSON.parse(download)).toEqual({
          schemaVersion: 1,
          remotelyConfirmed: false,
          task: first,
        });
        expect(await getDiscardedDailyRecordBackup(owner === OWNERS[0] ? 1002 : 1001)).toBeNull();
      }
    }
    expect(await fingerprint()).toBe(before);
  }
});
