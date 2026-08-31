/** Persisted cursor for the incremental Eloisa clinical enrichment pass. */

/**
 * v3: los hechos se persisten EMPAQUETADOS (`packedFacts`, un string por hecho)
 * en lugar de un objeto por hecho — el checkpoint pesaba ~180 KB de los ~500 KB
 * del documento diario y cada transacción lo movía completo. Un lector v3
 * acepta también la forma v2 (`facts`); un cliente v2 que vea la versión 3 lo
 * descarta y reconstruye, que es el comportamiento seguro.
 */
export const CLINICAL_SYNC_CHECKPOINT_VERSION = 3 as const;
export const CLINICAL_SYNC_COMPATIBLE_CHECKPOINT_VERSIONS: readonly number[] = [2, 3];
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
  /** Minimum history lookback proven by the last bounded full revalidation. */
  lastFullValidationLookbackDays?: number;
  /** Last bounded full-window attempt, whether or not the source certified it. */
  lastFullValidationAttemptAt?: string;
  /** History lookback requested by the last bounded full-window attempt. */
  lastFullValidationAttemptLookbackDays?: number;
  /**
   * Bounded overlap window used to recognize retries and late corrections.
   * v3: one packed string per fact — `identity|fingerprint|watermark`, with the
   * `v{fingerprintVersion}-` prefixes stripped (they live at checkpoint level).
   */
  packedFacts?: string[];
  /** Legacy v2 shape; readers must accept it, writers emit `packedFacts`. */
  facts?: ClinicalSyncFactCheckpoint[];
}

export interface ClinicalSyncCheckpoint {
  /** Persisted as a number so unknown future/legacy versions can be read and safely invalidated. */
  version: number;
  fingerprintVersion: number;
  sources: Partial<Record<ClinicalSyncSource, ClinicalSyncSourceCheckpoint>>;
}
