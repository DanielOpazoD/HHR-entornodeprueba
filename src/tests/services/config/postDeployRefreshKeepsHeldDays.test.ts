/* Synthetic only: the post-deploy refresh against the real local stores. */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
import { executePostDeployRecentRecordRefresh } from '@/services/config/postDeployRecentRecordRefresh';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { getSyncQueueTelemetry } from '@/services/storage/sync/publicSyncQueue';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const date = '2026-10-29';
const owner = 'user:synthetic-current';
const day = DataFactory.createMockDailyRecord(date, { beds: {} });
const marker = {
  version: 1 as const,
  reason: 'version-change' as const,
  fromVersion: 'synthetic-old',
  toVersion: 'synthetic-new',
  createdAt: '2026-10-29T03:00:00.000Z',
};
const dayWrite = (overrides: Partial<SyncTask> = {}): SyncTask => ({
  opId: 'synthetic-held',
  ownerKey: 'user:synthetic-other',
  type: 'UPDATE_DAILY_RECORD',
  key: `daily:${date}`,
  payload: day,
  timestamp: 1,
  retryCount: 0,
  status: 'PENDING',
  ...overrides,
});
const refresh = (readSyncQueueTelemetry = getSyncQueueTelemetry) => {
  const clearMarker = vi.fn();
  const syncRemoteRecord = vi.fn(async () => ({ status: 'success', issues: [] }));
  return {
    clearMarker,
    syncRemoteRecord,
    run: executePostDeployRecentRecordRefresh({
      todayDateString: date,
      readMarker: () => marker,
      clearMarker,
      readSyncQueueTelemetry,
      syncRemoteRecord,
    } as Parameters<typeof executePostDeployRecentRecordRefresh>[0]),
  };
};

beforeEach(async () => {
  localStorage.setItem(SESSION_OWNER_KEY, owner);
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
});
afterEach(() => localStorage.clear());

it("keeps a day that another person's pending send holds, and tries again later", async () => {
  await hospitalDB.dailyRecords.put(day);
  await hospitalDB.syncQueue.add(dayWrite());
  const { run, clearMarker, syncRemoteRecord } = refresh();

  expect((await run).status).toBe('skipped_queue_not_empty');
  expect(await hospitalDB.dailyRecords.get(date)).toEqual(day);
  expect(syncRemoteRecord).not.toHaveBeenCalled();
  expect(clearMarker).not.toHaveBeenCalled();
});

it('keeps a day whose edit was accepted after the queue was checked', async () => {
  const { run } = refresh(async () => {
    const telemetry = await getSyncQueueTelemetry();
    await hospitalDB.dailyRecords.put(day);
    await hospitalDB.syncQueue.add(dayWrite({ ownerKey: owner }));
    return telemetry;
  });

  expect((await run).status).toBe('skipped_queue_not_empty');
  expect(await hospitalDB.dailyRecords.get(date)).toEqual(day);
});

it('still refreshes a day when the only send left is a released one', async () => {
  await hospitalDB.dailyRecords.put(day);
  const id = await hospitalDB.syncQueue.add(
    dayWrite({ status: 'FAILED', projectionReleased: true })
  );
  const before = await hospitalDB.syncQueue.get(id);
  const { run, clearMarker, syncRemoteRecord } = refresh();

  expect((await run).status).toBe('completed');
  expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
  expect(syncRemoteRecord).toHaveBeenCalledWith(date);
  expect(clearMarker).toHaveBeenCalledOnce();
  expect(await hospitalDB.syncQueue.get(id)).toEqual(before);
});
