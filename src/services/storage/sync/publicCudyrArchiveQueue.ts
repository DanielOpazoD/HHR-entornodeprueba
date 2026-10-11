import { ensureDbReady } from '@/services/storage/indexeddb/indexedDbCore';
import type { CudyrArchiveOutboxPayload } from '@/types/domain/cudyrHistory';
import type { SyncQueueEnqueueOptions } from './syncQueueEnqueuePolicy';
import type { SyncQueueEnqueueResult } from './syncQueueEngineContracts';

/** The immutable CUDYR snapshot is the outbox payload: no separate local census write. */
export const createCudyrArchiveQueue =
  (
    enqueue: (
      type: 'ARCHIVE_CUDYR',
      payload: CudyrArchiveOutboxPayload,
      meta: { contexts: ['clinical'] },
      options: SyncQueueEnqueueOptions
    ) => Promise<SyncQueueEnqueueResult>
  ) =>
  async (payload: CudyrArchiveOutboxPayload, options: SyncQueueEnqueueOptions) => {
    await ensureDbReady();
    return enqueue('ARCHIVE_CUDYR', payload, { contexts: ['clinical'] }, options);
  };
