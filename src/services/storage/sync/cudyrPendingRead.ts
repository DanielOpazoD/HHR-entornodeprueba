import { ensureDbReady } from '@/services/storage/indexeddb/indexedDbCore';
import { createDexieSyncQueueStore } from './dexieSyncQueueStore';
import { guardAuthoringSession } from '@/services/session/authoringSession';
import { resolveCudyrOwningCensusDay } from '@/domain/evaluationScales/importedCudyr';
import type { CudyrArchiveOutboxPayload } from '@/types/domain/cudyrHistory';

/** A read-only, owner-scoped snapshot. Opening a report must never drain or start synchronization. */
export const readPendingCudyrEpisodes = async () => {
  const session = guardAuthoringSession({
    message: 'La sesión cambió durante la lectura de pendientes.',
  });
  const { ownerKey: owner, generation } = session.session;
  if (!owner || !generation) return [];
  session.check();
  await ensureDbReady();
  const rows = await createDexieSyncQueueStore().listAll(owner);
  session.check();
  return rows
    .filter(
      row => row.ownerKey === owner && row.type === 'ARCHIVE_CUDYR' && row.status !== 'RETIRED'
    )
    .map(row => {
      const request = (row.payload as CudyrArchiveOutboxPayload).request;
      return {
        clinicalEpisodeId:
          request.capture?.clinicalEpisodeId || request.evaluations[0]?.clinicalEpisodeId || '',
        dates: [
          ...new Set([
            request.authorityDate,
            ...request.evaluations.map(item => resolveCudyrOwningCensusDay(item.recordedAt) || ''),
          ]),
        ],
      };
    });
};
