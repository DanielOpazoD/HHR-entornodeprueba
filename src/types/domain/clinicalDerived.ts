import type { ClinicalSyncCheckpoint } from './clinicalSync';
import type { PatientVitalSigns } from './vitalSigns';

/**
 * Root marker of a day whose moved clinical fields live in per-episode documents. Only the server
 * sets it; a client update can never add, change or remove it (Firestore rules).
 */
export interface ClinicalDerivedLayout {
  version: number;
  /** Server-generated id; a recreated day gets a new one, so earlier documents stop counting. */
  generation: string;
}

export type ClinicalDerivedTarget = 'bed' | 'clinicalCrib';

/**
 * `hospitals/{hospitalId}/dailyRecords/{date}/clinicalDerived/{clinicalEpisodeId}`, written only by
 * the server. A moved field present here wins over the day's embedded copy, even when null.
 */
export interface ClinicalDerivedEpisodeDoc {
  schemaVersion: 1;
  date: string;
  clinicalEpisodeId: string;
  /** Must equal the day marker's generation to count. */
  layoutGeneration: string;
  /** Informational: where the episode was at the last write. Matching uses the episode id only. */
  target?: ClinicalDerivedTarget;
  bedId?: string;
  /** Day `meta.revision` written in the same transaction. */
  dayRevision: number;
  updatedAt?: unknown;
  lastMutationId?: string | null;
  clinicalSyncCheckpoint?: ClinicalSyncCheckpoint | null;
  vitalSignsHistory?: PatientVitalSigns[] | null;
}
