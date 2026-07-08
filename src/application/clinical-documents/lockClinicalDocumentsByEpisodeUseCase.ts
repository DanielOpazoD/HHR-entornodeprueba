/**
 * Use case: lock every clinical document linked to a closed hospitalization
 * episode (discharge, transfer, death, fuga). Wraps the repository write
 * (via `ClinicalDocumentPort`) so feature controllers can request the
 * operation without crossing the controller → repository boundary directly.
 */

import {
  defaultClinicalDocumentPort,
  type ClinicalDocumentPort,
} from '@/application/ports/clinicalDocumentPort';

export interface LockClinicalDocumentsByEpisodeInput {
  episodeKey: string;
  hospitalId?: string;
  /** ISO timestamp recorded on every document the operation locks. */
  lockedAt?: string;
}

interface LockClinicalDocumentsByEpisodeDeps {
  clinicalDocumentPort?: ClinicalDocumentPort;
}

/**
 * Returns the IDs of documents that transitioned from unlocked to locked,
 * so the caller can emit one audit event per document affected.
 */
export const executeLockClinicalDocumentsByEpisode = async (
  input: LockClinicalDocumentsByEpisodeInput,
  dependencies: LockClinicalDocumentsByEpisodeDeps = {}
): Promise<string[]> => {
  const port = dependencies.clinicalDocumentPort || defaultClinicalDocumentPort;
  return port.lockDocumentsByEpisodeKey(input.episodeKey, input.hospitalId, {
    lockedAt: input.lockedAt,
  });
};
