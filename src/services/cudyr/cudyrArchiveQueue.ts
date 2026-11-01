import type { ArchiveCudyrHistoryRequest } from '@/types/domain/cudyrHistory';
import { assertCudyrArchiveAcknowledged } from './cudyrArchiveAcknowledgement';
import { archiveCudyrHistory } from './cudyrHistoryService';
import {
  ensureDbReady,
  isDatabaseInFallbackMode,
} from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { queueCudyrArchiveTask, processSyncQueue } from '@/services/storage/sync/publicSyncQueue';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';

export type CudyrArchiveDisposition = 'persisted' | 'queued' | 'failed';

/** Save before sending. An ambiguous response keeps the exact source snapshot for replay. */
export const persistCudyrArchivePart = async (
  request: ArchiveCudyrHistoryRequest,
  signal?: AbortSignal,
  checkSession: () => void = () => undefined
): Promise<CudyrArchiveDisposition> => {
  const owner = getStoredSessionOwnerKey();
  const generation = getSessionGeneration();
  const sameSession = () =>
    owner === getStoredSessionOwnerKey() && generation === getSessionGeneration();
  checkSession();
  await ensureDbReady();
  checkSession();
  if (!owner || !generation || !sameSession() || isDatabaseInFallbackMode()) return 'failed';
  const id = crypto.randomUUID();
  const key = `cudyr:${id}`;
  const store = createDexieSyncQueueStore();
  const queued = await queueCudyrArchiveTask(
    { id, request },
    {
      deferProcessing: true,
      holdForMs: 30_000,
      preOutboxHoldOwner: id,
      preOutboxHoldReason: 'awaiting_remote_ack',
    }
  );
  checkSession();
  if (!queued.accepted || !sameSession()) return 'failed';
  let acknowledged = false;
  let onAbort: (() => void) | undefined;
  try {
    if (signal?.aborted) return 'queued';
    const result = await new Promise<Awaited<ReturnType<typeof archiveCudyrHistory>>>(
      (resolve, reject) => {
        onAbort = () => reject(new Error('CUDYR foreground wait aborted'));
        signal?.addEventListener('abort', onAbort, { once: true });
        // Both handlers stay attached after cancellation: a late response cannot acknowledge
        // or delete the durable item; the background protocol will reconcile it idempotently.
        archiveCudyrHistory(request).then(resolve, reject);
      }
    );
    checkSession();
    if (!sameSession()) return 'queued';
    assertCudyrArchiveAcknowledged(request, result);
    acknowledged = true;
    if (sameSession()) await store.deletePendingByKey('ARCHIVE_CUDYR', key, owner);
    checkSession();
    return sameSession() ? 'persisted' : 'queued';
  } catch {
    return acknowledged && sameSession() ? 'persisted' : 'queued';
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    if (!acknowledged && sameSession()) {
      await store.releasePreOutboxHoldByKey('ARCHIVE_CUDYR', key, owner).catch(() => undefined);
      if (sameSession()) void processSyncQueue();
    }
  }
};
