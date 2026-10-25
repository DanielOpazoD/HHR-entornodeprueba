import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import type { SyncTransportPort } from '@/services/storage/sync/syncQueuePorts';
import { docToRecord } from '@/services/storage/firestore/firestoreShared';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { IDENTITY_REVIEW_DATE as DATE, storedDay } from '@/tests/fixtures/identityReviewDayFixture';

const PENDING = 'DIAGNOSTICO PENDIENTE SINTETICO';

const engineWith = (transport: SyncTransportPort) =>
  createSyncQueueEngine({
    store: createDexieSyncQueueStore(),
    runtime: { isOnline: () => false, getOwnerKey: () => null, onOnline: () => {} },
    transport,
    batchSize: 5,
    maxPendingTasks: 100,
    maxRetries: 3,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 30_000,
  });

describe('a queued day whose replay left the edit of a bed under review out', () => {
  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
    await hospitalDB.dailyRecords.clear();
  });

  it('keeps only that edit, as a conflict, with the local copy it was written on', async () => {
    const local = docToRecord(storedDay(), DATE);
    local.beds.R1.pathology = PENDING;
    local.beds.R2.pathology = 'DIAGNOSTICO R2 EDITADO';
    // The stored day after the replay: the edit of R2 written, the one of R1 left out.
    const written: DailyRecord = {
      ...docToRecord(storedDay(), DATE),
      lastUpdated: `${DATE}T09:00:00.000Z`,
    };
    written.beds.R2.pathology = 'DIAGNOSTICO R2 EDITADO';
    const engine = engineWith({
      run: async () => ({ authoritativeRecord: written, detachedPaths: ['beds.R1.pathology'] }),
    });
    await engine.queueDailyRecordTaskWithLocalRecord(
      local,
      {
        syncContract: {
          changedPaths: ['beds.R1.pathology', 'beds.R2.pathology'],
          mutationId: 'synthetic-mutation',
        },
      },
      { deferProcessing: true }
    );

    await engine.processQueue();

    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      status: 'CONFLICT',
      lastErrorCode: 'identity_review_edit_detached',
      lastErrorCategory: 'conflict',
      syncContract: { changedPaths: ['beds.R1.pathology'] },
    });
    expect(tasks[0].syncContract?.mutationId).not.toBe('synthetic-mutation');
    expect(tasks[0].error).toContain('R1');
    expect((tasks[0].payload as DailyRecord).beds.R1.pathology).toBe(PENDING);
    expect((await hospitalDB.dailyRecords.get(DATE))?.beds.R1.pathology).toBe(PENDING);
  });
});
