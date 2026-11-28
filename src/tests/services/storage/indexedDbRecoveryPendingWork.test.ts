import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  ensureDbReady,
  getLocalPersistenceRuntimeSnapshot,
  HangaRoaDatabase,
  hospitalDB,
} from '@/services/storage/indexeddb/indexedDbCore';
import {
  INDEXED_DB_RECOVERY_RETRY_DELAYS_MS,
  MAX_BACKGROUND_RECOVERY_ATTEMPTS,
} from '@/services/storage/indexeddb/indexedDbRecoveryBudgets';
import type { SyncTask } from '@/services/storage/syncQueueTypes';

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  hospitalDB.close();
});

it('bounds automatic open attempts and recovers the durable edit when storage returns', async () => {
  const pending: SyncTask = {
    type: 'UPDATE_DAILY_RECORD',
    key: 'daily:2026-05-12',
    ownerKey: 'user:synthetic',
    status: 'PENDING',
    opId: 'synthetic-edit',
    timestamp: 1,
    retryCount: 0,
    payload: { date: '2026-05-12', handoffNovedadesDayShift: 'Nota sintética pendiente' },
  };
  const initial = new HangaRoaDatabase();
  await initial.open();
  const id = await initial.syncQueue.add(pending);
  initial.close();

  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const open = vi
    .spyOn(HangaRoaDatabase.prototype, 'open')
    .mockRejectedValue(new DOMException('Internal error opening backing store', 'UnknownError'));
  const started = ensureDbReady();
  await vi.advanceTimersByTimeAsync(200_000);
  await started;
  expect(getLocalPersistenceRuntimeSnapshot().runtimeState).toBe('recoverable');
  expect(open).toHaveBeenCalledTimes(
    (1 + MAX_BACKGROUND_RECOVERY_ATTEMPTS) * INDEXED_DB_RECOVERY_RETRY_DELAYS_MS.length
  );
  expect(vi.getTimerCount()).toBe(0);

  open.mockRestore();
  vi.useRealTimers();
  await ensureDbReady({ allowRecoveryWhenMock: true });
  expect(getLocalPersistenceRuntimeSnapshot().runtimeState).toBe('ok');
  expect(await hospitalDB.syncQueue.get(id)).toEqual({ ...pending, id });
});
