import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hospitalDB } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createCudyrPolicyBlockedRecovery } from '@/services/storage/sync/cudyrPolicyBlockedRecovery';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

const blocked = (overrides: Partial<SyncTask> = {}): SyncTask => ({
  opId: 'capture',
  type: 'ARCHIVE_CUDYR',
  status: 'FAILED',
  ownerKey: 'owner',
  timestamp: 1,
  retryCount: 0,
  lastErrorCode: 'functions/failed-precondition',
  error:
    '[validation/functions/failed-precondition] Clinical enrichment is not authorized by the current global policy.',
  payload: { request: { observedAt: '2026-10-09T12:00:00Z', sourceRunId: 'original' } },
  ...overrides,
});
const setup = () => {
  const process = vi.fn(async () => {});
  let owner = 'owner',
    generation = 'generation';
  const store = createDexieSyncQueueStore();
  const recovery = createCudyrPolicyBlockedRecovery({
    ensureReady: async () => {},
    store,
    getOwner: () => owner,
    getGeneration: () => generation,
    process,
  });
  return {
    recovery,
    store,
    process,
    setOwner: (value: string) => {
      owner = value;
    },
    setGeneration: (value: string) => {
      generation = value;
    },
  };
};
beforeEach(async () => {
  await hospitalDB.syncQueue.clear();
});

describe('CUDYR policy-blocked archive recovery', () => {
  it('recovers all 17 owned policy failures in one batch, preserving the original capture', async () => {
    await hospitalDB.syncQueue.bulkAdd(
      Array.from({ length: 17 }, (_, i) => blocked({ opId: `capture-${i}` }))
    );
    const { recovery, process } = setup();
    expect(await recovery(true)).toBe(17);
    const tasks = await hospitalDB.syncQueue.toArray();
    expect(tasks).toHaveLength(17); // no deletion until remote acknowledgement
    expect(tasks.every(task => task.status === 'PENDING' && task.error === undefined)).toBe(true);
    expect(
      tasks.every(task => JSON.stringify(task.payload) === JSON.stringify(blocked().payload))
    ).toBe(true);
    expect(process).toHaveBeenCalledTimes(1);
    expect(await recovery(true)).toBe(0); // active tasks are not reset
  });

  it('never revives unrelated validation, conflicts, daily writes, foreign or unowned tasks', async () => {
    const tasks = [
      blocked({ error: 'Other validation' }),
      blocked({ status: 'CONFLICT' }),
      blocked({ type: 'UPDATE_DAILY_RECORD' }),
      blocked({ ownerKey: 'other' }),
      blocked({ ownerKey: undefined }),
      blocked({ lastErrorCode: 'functions/permission-denied' }),
    ];
    await hospitalDB.syncQueue.bulkAdd(tasks);
    const before = await hospitalDB.syncQueue.toArray();
    const { recovery, process } = setup();
    expect(await recovery(true)).toBe(0);
    expect(await hospitalDB.syncQueue.toArray()).toEqual(before);
    expect(process).not.toHaveBeenCalled();
  });

  it('does not touch the queue when current clinical authority is unavailable', async () => {
    await hospitalDB.syncQueue.add(blocked());
    const { recovery, process } = setup();
    expect(await recovery(false)).toBe(0);
    expect((await hospitalDB.syncQueue.toArray())[0].status).toBe('FAILED');
    expect(process).not.toHaveBeenCalled();
  });

  it('rejects a stale caller after an asynchronous recovery module load crosses sessions', async () => {
    await hospitalDB.syncQueue.add(blocked());
    const state = setup();
    state.setGeneration('replacement');
    expect(await state.recovery(true, 'generation')).toBe(0);
    expect((await hospitalDB.syncQueue.toArray())[0].status).toBe('FAILED');
    expect(state.process).not.toHaveBeenCalled();
  });

  it('rolls back the entire recovery if the admitted session changes during the transaction', async () => {
    await hospitalDB.syncQueue.bulkAdd([blocked(), blocked({ opId: 'second' })]);
    const state = setup();
    const requeue = state.store.requeueQuarantinedTask!;
    state.store.requeueQuarantinedTask = async (...args) => {
      const changed = await requeue(...args);
      state.setGeneration('replacement');
      return changed;
    };
    await expect(state.recovery(true)).rejects.toThrow('sesión cambió');
    expect((await hospitalDB.syncQueue.toArray()).every(task => task.status === 'FAILED')).toBe(
      true
    );
    expect(state.process).not.toHaveBeenCalled();
  });
  it('rolls back all requeues if current policy is revoked during the transaction', async () => {
    await hospitalDB.syncQueue.bulkAdd([blocked(), blocked({ opId: 'second' })]);
    const state = setup();
    let authorized = true;
    const requeue = state.store.requeueQuarantinedTask!;
    state.store.requeueQuarantinedTask = async (...args) => {
      const changed = await requeue(...args);
      authorized = false;
      return changed;
    };
    await expect(state.recovery(true, 'generation', () => authorized)).rejects.toThrow('política');
    expect((await hospitalDB.syncQueue.toArray()).every(task => task.status === 'FAILED')).toBe(
      true
    );
    expect(state.process).not.toHaveBeenCalled();
  });
});
