/* Synthetic only: a stopped day write released past the nurse window, against the real local stores. */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { isClosedNurseWindowRefusal } from '@/services/storage/sync/dailyRecordBaseReview';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { DAILY_RECORD_STORE_CHANGED_EVENT } from '@/services/storage/indexeddb/indexedDbRecordEvents';
import { clinicalWallClockToDate } from '@/utils/clinicalWallClock';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const date = '2026-11-15';
const closesAt = clinicalWallClockToDate(date, '00:00').getTime() + 48 * 3_600_000;
const day = DataFactory.createMockDailyRecord(date, { beds: {} });
const claim = { leaseOwner: 'worker-synthetic', leaseUntil: 9e15, attemptId: 'attempt-synthetic' };
const dayWrite = (overrides: Partial<SyncTask> = {}): SyncTask => ({
  opId: 'synthetic-stopped',
  ownerKey: 'user:synthetic-nurse',
  type: 'UPDATE_DAILY_RECORD',
  key: `daily:${date}`,
  payload: day,
  timestamp: 1,
  retryCount: 0,
  status: 'PROCESSING',
  ...claim,
  ...overrides,
});
const stop = { status: 'FAILED' as const, lastErrorCode: 'permission-denied' };

let deleted: unknown[] = [];
const onStoreChanged = (event: Event) => deleted.push((event as CustomEvent).detail);
beforeEach(async () => {
  deleted = [];
  window.addEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, onStoreChanged);
  await hospitalDB.dailyRecords.clear();
  await hospitalDB.syncQueue.clear();
});
afterEach(() => window.removeEventListener(DAILY_RECORD_STORE_CHANGED_EVENT, onStoreChanged));

describe('releasing a stopped day write', () => {
  it('drops the stored day it held, keeps the task and its payload, and says the day changed', async () => {
    await hospitalDB.dailyRecords.put(day);
    const id = (await hospitalDB.syncQueue.add(dayWrite())) as number;

    const stored = createDexieSyncQueueStore().updateClaimed(
      id,
      { ...stop, projectionReleased: true },
      claim
    );

    expect(await stored).toBe(true);
    expect(await hospitalDB.dailyRecords.get(date)).toBeUndefined();
    expect(await hospitalDB.syncQueue.get(id)).toMatchObject({
      ...stop,
      projectionReleased: true,
      payload: day,
    });
    expect(deleted).toEqual([{ operation: 'delete', dates: [date] }]);
  });

  it('keeps the stored day while another write still holds it', async () => {
    await hospitalDB.dailyRecords.put(day);
    const id = (await hospitalDB.syncQueue.add(dayWrite())) as number;
    await hospitalDB.syncQueue.add(
      dayWrite({ opId: 'synthetic-other', ownerKey: 'user:synthetic-other', status: 'PENDING' })
    );

    expect(
      await createDexieSyncQueueStore().updateClaimed(
        id,
        { ...stop, projectionReleased: true },
        claim
      )
    ).toBe(true);
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(day);
    expect((await hospitalDB.syncQueue.get(id))?.projectionReleased).toBe(true);
    expect(deleted).toEqual([]);
  });

  it('changes nothing when the claim was lost', async () => {
    await hospitalDB.dailyRecords.put(day);
    const id = (await hospitalDB.syncQueue.add(dayWrite({ attemptId: 'attempt-newer' }))) as number;

    expect(
      await createDexieSyncQueueStore().updateClaimed(
        id,
        { ...stop, projectionReleased: true },
        claim
      )
    ).toBe(false);
    expect(await hospitalDB.dailyRecords.get(date)).toEqual(day);
    expect(await hospitalDB.syncQueue.get(id)).toMatchObject({ status: 'PROCESSING' });
    expect((await hospitalDB.syncQueue.get(id))?.projectionReleased).toBeUndefined();
  });
});

describe('which stopped sends the closed window releases', () => {
  const refused = { type: 'UPDATE_DAILY_RECORD' as const, key: `daily:${date}`, ...stop };

  it('releases a refused census day once its window closed, on either server path', () => {
    expect(isClosedNurseWindowRefusal(refused, closesAt)).toBe(true);
    expect(
      isClosedNurseWindowRefusal(
        { ...refused, lastErrorCode: 'functions/permission-denied' },
        closesAt
      )
    ).toBe(true);
  });

  it.each([
    ['inside the window (a role change)', refused, closesAt - 1],
    ['another stop reason', { ...refused, lastErrorCode: 'failed-precondition' }, closesAt],
    ['a send that may still retry', { ...refused, status: 'PENDING' as const }, closesAt],
    ['a detached part of the day', { ...refused, key: `daily:${date}:detached:R1` }, closesAt],
    ['a future day', { ...refused, key: 'daily:2026-11-30' }, closesAt],
    ['an impossible day', { ...refused, key: 'daily:2026-02-30' }, closesAt],
    ['another kind of send', { ...refused, type: 'UPDATE_PATIENT' as const }, closesAt],
  ])('keeps %s as before', (_case, task, now) => {
    expect(isClosedNurseWindowRefusal(task, now)).toBe(false);
  });
});
