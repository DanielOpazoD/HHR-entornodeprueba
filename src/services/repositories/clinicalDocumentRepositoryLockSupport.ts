/**
 * Implementation of `ClinicalDocumentRepository.lockDocumentsByEpisodeKey`,
 * extracted into its own module so the parent repository file stays under
 * the architectural module-size limit. Wired back as a thin method on the
 * repository.
 */

import type { ClinicalDocumentRecord } from '@/domain/clinical-documents/entities';

export interface LockDocumentsByEpisodeKeyDeps {
  listByEpisode: (episodeKey: string, hospitalId: string) => Promise<ClinicalDocumentRecord[]>;
  applyLockPatchToFirestore: (
    documentId: string,
    patch: { isLocked: true; lockedReason: 'episode_closed'; lockedAt: string },
    hospitalId: string
  ) => Promise<void>;
  applyLockPatchToLocalStore: (
    record: ClinicalDocumentRecord,
    patch: { isLocked: true; lockedReason: 'episode_closed'; lockedAt: string },
    hospitalId: string
  ) => void;
  isFirestoreEnabled: () => boolean;
}

/**
 * Returns the IDs of documents that transitioned from unlocked to locked.
 * Idempotent: documents already locked are skipped, so re-running the
 * operation is safe.
 */
export const executeLockDocumentsByEpisodeKey = async (
  episodeKey: string,
  hospitalId: string,
  options: { lockedAt?: string } = {},
  deps: LockDocumentsByEpisodeKeyDeps
): Promise<string[]> => {
  const lockedAt = options.lockedAt ?? new Date().toISOString();
  const documents = await deps.listByEpisode(episodeKey, hospitalId);
  const newlyLocked: string[] = [];

  for (const document of documents) {
    if (document.isLocked) continue;

    const lockPatch = {
      isLocked: true as const,
      lockedReason: 'episode_closed' as const,
      lockedAt,
    };

    if (!deps.isFirestoreEnabled()) {
      deps.applyLockPatchToLocalStore(document, lockPatch, hospitalId);
    } else {
      await deps.applyLockPatchToFirestore(document.id, lockPatch, hospitalId);
    }

    newlyLocked.push(document.id);
  }

  return newlyLocked;
};
