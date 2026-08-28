import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { hospitalDB } from '@/services/storage/indexedDBService';
import {
  getDailyRecordWriteStateForVersion,
  hasUnresolvedDailyRecordWriteForDate,
} from '@/services/storage/sync/dailyRecordSyncQueueReadService';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const record = (lastUpdated: string): DailyRecord =>
  ({
    date: '2026-08-17',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    activeExtraBeds: [],
    lastUpdated,
  }) as DailyRecord;

const task = (payload: DailyRecord, status: SyncTask['status']): SyncTask => ({
  opId: `test-${status}-${payload.lastUpdated}`,
  type: 'UPDATE_DAILY_RECORD',
  payload,
  key: `daily:${payload.date}`,
  timestamp: Date.now(),
  retryCount: 0,
  status,
});

describe('dailyRecordSyncQueueReadService', () => {
  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
  });

  it('recognizes only an active task for the exact local record version', async () => {
    const pending = record('2026-08-17T20:00:00.000Z');
    await hospitalDB.syncQueue.add(task(pending, 'PENDING'));

    await expect(
      getDailyRecordWriteStateForVersion(pending.date, pending.lastUpdated)
    ).resolves.toBe('active');
    await expect(
      getDailyRecordWriteStateForVersion(pending.date, '2026-08-17T20:00:01.000Z')
    ).resolves.toBe('none');
    await expect(hasUnresolvedDailyRecordWriteForDate(pending.date)).resolves.toBe(true);
  });

  it('detects an active write for the date even when it belongs to another revision', async () => {
    const queued = record('2026-08-17T20:00:00.000Z');
    await hospitalDB.syncQueue.add(task(queued, 'PROCESSING'));

    await expect(
      getDailyRecordWriteStateForVersion(queued.date, '2026-08-17T20:00:01.000Z')
    ).resolves.toBe('none');
    await expect(hasUnresolvedDailyRecordWriteForDate(queued.date)).resolves.toBe(true);
  });

  it('keeps failed and conflicted exact versions visible to block structural overwrite', async () => {
    const failed = record('2026-08-17T20:00:00.000Z');
    await hospitalDB.syncQueue.add(task(failed, 'FAILED'));

    await expect(getDailyRecordWriteStateForVersion(failed.date, failed.lastUpdated)).resolves.toBe(
      'failed'
    );

    await hospitalDB.syncQueue.add(task(failed, 'CONFLICT'));
    await expect(getDailyRecordWriteStateForVersion(failed.date, failed.lastUpdated)).resolves.toBe(
      'conflict'
    );
  });

  it.each(['FAILED', 'CONFLICT'] as const)(
    'blocks a date-level checkpoint for an unresolved %s write from another revision',
    async status => {
      const unresolved = record('2026-08-17T20:00:00.000Z');
      await hospitalDB.syncQueue.add(task(unresolved, status));

      await expect(
        getDailyRecordWriteStateForVersion(unresolved.date, '2026-08-17T20:00:01.000Z')
      ).resolves.toBe('none');
      await expect(hasUnresolvedDailyRecordWriteForDate(unresolved.date)).resolves.toBe(true);
    }
  );
});
