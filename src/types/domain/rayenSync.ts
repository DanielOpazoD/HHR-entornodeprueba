/** Persisted, privacy-safe evidence for one user-initiated Eloísa synchronization. */

export const MAX_RAYEN_SYNC_HISTORY = 20;

export type RayenSyncStatus = 'applied' | 'complete' | 'partial' | 'failed';

export type RayenExtensionEndpointStatus = 'ready' | 'missing' | 'stale';

export type RayenSyncFailureReason =
  | 'extension_unavailable'
  | 'extension_incompatible'
  | 'ficha_medico_unavailable'
  | 'snapshot_timeout'
  | 'snapshot_error'
  | 'apply_failed';

export interface RayenSyncCoverage {
  /** Patients eligible for the clinical enrichment pass. */
  total: number;
  /** Patients whose technical pass finished without a patient-scoped error. */
  completed: number;
  /** Patients with at least one patient-scoped error. */
  errors: number;
  /** Total source/patch errors, including global source failures. */
  sourceErrors: number;
  completedAt: string;
}

export interface RayenSyncChanges {
  admissions: number;
  updates: number;
  moves: number;
  discharges: number;
  unchanged: number;
}

export interface RayenSyncSource {
  extensionVersion?: string;
  protocolVersion?: number;
  fichaMedico?: RayenExtensionEndpointStatus;
  gestionCamas?: RayenExtensionEndpointStatus;
}

export interface RayenSyncEvent {
  /** Stable run id. Updating a run replaces this event instead of appending a duplicate. */
  id: string;
  startedAt: string;
  completedAt?: string;
  by: string;
  status: RayenSyncStatus;
  coverage?: RayenSyncCoverage;
  changes?: RayenSyncChanges;
  source?: RayenSyncSource;
  /** Sanitized operational category; never a raw extension/server error. */
  failureReason?: RayenSyncFailureReason;
}

/** Backward-compatible projection of the latest successfully applied Eloísa sync. */
export interface RayenSyncMeta {
  at: string;
  by: string;
  runId?: string;
  status?: Exclude<RayenSyncStatus, 'failed'>;
  coverage?: RayenSyncCoverage;
  changes?: RayenSyncChanges;
  source?: RayenSyncSource;
}
