import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { preserveSessionSyncQueue } from '@/services/storage/sessionSyncQueuePreservation';
import { matchesTaskClaim } from '@/services/storage/sync/syncQueueTaskFactory';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
const owner = 'user:hhrn_synthetic';
const task = (opId: string, ownerKey?: string): SyncTask => ({
  type: 'UPDATE_DAILY_RECORD',
  payload: { date: '2026-01-01', synthetic: 'pending work' },
  timestamp: 1,
  retryCount: 0,
  status: 'PROCESSING',
  opId,
  ownerKey,
  leaseOwner: 'old-worker',
  leaseUntil: 20000,
  attemptId: 'old-attempt',
  syncContract: { changedPaths: ['nursesDayShift'], expectedVersion: 'original-version' },
});
describe('individual session logout preserves pending edits', () => {
  beforeEach(async () => {
    await hospitalDB.syncQueue.clear();
  });
  it('keeps payload, identity and expected revision, fences late acknowledgements and isolates the next user', async () => {
    const own = task('own', owner);
    const other = task('other', 'user:other');
    const id = await hospitalDB.syncQueue.add(own);
    await hospitalDB.syncQueue.add(other);
    await preserveSessionSyncQueue(owner);
    const preserved = await hospitalDB.syncQueue.get(id);
    expect(preserved).toMatchObject({
      payload: own.payload,
      ownerKey: owner,
      syncContract: own.syncContract,
      status: 'FAILED',
    });
    expect(
      matchesTaskClaim(preserved, {
        leaseOwner: 'old-worker',
        attemptId: 'old-attempt',
        leaseUntil: 20000,
      })
    ).toBe(false);
    const visibleToNext = await createDexieSyncQueueStore().listAll('user:other');
    expect(visibleToNext).toHaveLength(1);
    expect(visibleToNext[0]).toMatchObject(other);
  });
  it('does not adopt unattributed work, reactivate retired work or erase conflict evidence', async () => {
    await hospitalDB.syncQueue.add(task('unattributed'));
    await hospitalDB.syncQueue.add({ ...task('conflict', owner), status: 'CONFLICT' });
    const retirement = {
      reason: 'empty_capture_without_census_context' as const,
      retiredAt: '2026-01-01',
      authorityDate: '2026-01-01',
      verifiedRunId: 'original-run',
    };
    await hospitalDB.syncQueue.add({ ...task('retired', owner), status: 'RETIRED', retirement });
    await preserveSessionSyncQueue(owner);
    const all = await hospitalDB.syncQueue.toArray();
    expect(all).toHaveLength(3);
    expect(all.find(t => t.opId === 'retired')).toMatchObject({ status: 'RETIRED', retirement });
    expect(all.find(t => t.opId === 'conflict')?.status).toBe('CONFLICT');
    expect(await createDexieSyncQueueStore().listAll('user:next')).toEqual([]);
  });
});
