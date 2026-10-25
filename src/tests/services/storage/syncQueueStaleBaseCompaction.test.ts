import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import type { DailyRecord } from '@/types/domain/dailyRecord';

const date = '2026-10-24';
const record = (lastUpdated: string, overrides: Partial<DailyRecord> = {}): DailyRecord => ({
  date,
  lastUpdated,
  beds: {},
  nurses: [],
  activeExtraBeds: [],
  discharges: [],
  transfers: [],
  cma: [],
  nursesDayShift: ['SINTETICA BASE'],
  tensDayShift: ['SINTETICO BASE'],
  ...overrides,
});
const engine = () =>
  createSyncQueueEngine({
    store: createDexieSyncQueueStore(),
    runtime: { isOnline: () => false, getOwnerKey: () => 'user:sintetico', onOnline: () => {} },
    transport: { run: async () => {} },
    batchSize: 8,
    maxPendingTasks: 192,
    maxRetries: 5,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30000,
  });

describe('queue compaction keeps every accepted pending edit', () => {
  beforeEach(async () => {
    await hospitalDB.dailyRecords.clear();
    await hospitalDB.syncQueue.clear();
  });

  it('a record from a stale tab snapshot does not erase an earlier independent edit', async () => {
    const base = record('2026-10-24T10:00:00.000Z');
    const queue = engine();
    await queue.queueDailyRecordTaskWithLocalRecord(
      { ...base, lastUpdated: '2026-10-24T10:01:00.000Z', nursesDayShift: ['SINTETICA A'] },
      { syncContract: { expectedVersion: base.lastUpdated, changedPaths: ['nursesDayShift'] } }
    );
    const second = await queue.queueDailyRecordTaskWithLocalRecord(
      { ...base, lastUpdated: '2026-10-24T10:02:00.000Z', tensDayShift: ['SINTETICO B'] },
      { syncContract: { expectedVersion: base.lastUpdated, changedPaths: ['tensDayShift'] } }
    );

    expect(second).toMatchObject({ accepted: true, mode: 'reused' });
    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    const payload = tasks[0].payload as DailyRecord;
    expect(payload.nursesDayShift).toEqual(['SINTETICA A']);
    expect(payload.tensDayShift).toEqual(['SINTETICO B']);
    expect(tasks[0].syncContract?.changedPaths).toEqual(['nursesDayShift', 'tensDayShift']);
    const projection = await hospitalDB.dailyRecords.get(date);
    expect(projection?.nursesDayShift).toEqual(['SINTETICA A']);
    expect(projection?.tensDayShift).toEqual(['SINTETICO B']);
  });
});
