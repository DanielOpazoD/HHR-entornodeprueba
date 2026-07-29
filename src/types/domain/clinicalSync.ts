/** Persisted cursor for the incremental Eloisa clinical enrichment pass. */

export const CLINICAL_SYNC_CHECKPOINT_VERSION = 2 as const;
export const CLINICAL_SYNC_FINGERPRINT_VERSION = 1 as const;

export type ClinicalSyncSource = 'vitals' | 'scales' | 'staffing';

/**
 * Privacy-safe evidence for a source fact. Both values are deterministic hashes: neither contains
 * a patient, professional or clinical value in plaintext.
 */
export interface ClinicalSyncFactCheckpoint {
  identity: string;
  fingerprint: string;
  /** Non-identifying ordering key used to retain the newest overlap facts. */
  watermark?: string;
}

export interface ClinicalSyncSourceCheckpoint {
  /** Latest source ordering key observed, when the source exposes one. */
  watermark?: string;
  /** Last bounded full revalidation; updated at most once per day. */
  lastFullValidationAt?: string;
  /** Last successful capped attempt; throttles reads that cannot cover the entire census age. */
  lastFullValidationAttemptAt?: string;
  /** Bounded overlap window used to recognize retries and late corrections. */
  facts: ClinicalSyncFactCheckpoint[];
}

export interface ClinicalSyncCheckpoint {
  /** Persisted as a number so unknown future/legacy versions can be read and safely invalidated. */
  version: number;
  fingerprintVersion: number;
  sources: Partial<Record<ClinicalSyncSource, ClinicalSyncSourceCheckpoint>>;
}
