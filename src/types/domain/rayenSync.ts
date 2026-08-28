/** Persisted, privacy-safe evidence for one user-initiated Eloísa synchronization. */

export const MAX_RAYEN_SYNC_HISTORY = 20;
export const MAX_RAYEN_STAFFING_BOUNDARY_EVIDENCE = 40;
export const MAX_RAYEN_STRUCTURAL_REVIEW_ISSUES = 12;

export type RayenSyncStatus = 'applied' | 'complete' | 'partial' | 'failed';

/** Immutable global import policy captured when a synchronization starts. */
export interface RayenSyncPolicy {
  mode: 'preview' | 'auto';
  /** Absent only on synchronization events created before the global clinical policy existed. */
  clinicalBatchMode?: 'off' | 'shadow' | 'enforced';
  revision: number;
}

/**
 * Frozen authority proof attached only to legacy clinical writes from one synchronization run.
 * Firestore revalidates it atomically before committing so a later promotion to `enforced`
 * cannot leave an older client writing through the legacy path.
 */
export interface RayenClinicalWriteGuard {
  runId: string;
  /** Structural import mode frozen by the same server-confirmed policy revision. */
  importMode: 'preview' | 'auto';
  clinicalBatchMode: 'off' | 'shadow' | 'enforced';
  revision: number;
  /** Daily record that owns the authoritative synchronization event. */
  sourceDate: string;
  /** Historical CUDYR targets live in another daily record; sourceDate still owns the run event. */
  recordScope: 'run' | 'historical';
}

export type RayenExtensionEndpointStatus = 'ready' | 'missing' | 'stale';

export const RAYEN_SYNC_ISSUE_SOURCES = [
  'census',
  'devices',
  'scales',
  'vitals',
  'staffing',
  'cudyr',
  'patch',
] as const;
export type RayenSyncIssueSource = (typeof RAYEN_SYNC_ISSUE_SOURCES)[number];

export const RAYEN_SYNC_ISSUE_REASONS = [
  'concurrent_write',
  'source_unavailable',
  'source_timeout',
  'historical_archive_failed',
  'historical_census_write_failed',
  'structural_conflict',
  'sync_already_running',
  'record_load_failed',
  'write_failed',
  'unexpected',
] as const;
export type RayenSyncIssueReason = (typeof RAYEN_SYNC_ISSUE_REASONS)[number];

export type RayenSyncStructuralIssueReason =
  | 'unconfirmed-principal-bed'
  | 'principal-bed-collision'
  | 'cma-physical-bed-collision'
  | 'occupied-local-bed'
  | 'historical-reconstruction'
  | 'historical-admission-evidence'
  | 'unclassified';

/** Privacy-safe structural diagnostic. It deliberately omits patient and episode identifiers. */
export interface RayenSyncStructuralIssue {
  bedId: string | null;
  reason: RayenSyncStructuralIssueReason;
}

/** Sanitized patient-scoped diagnostic. Raw Eloísa/Firestore errors are never persisted. */
export interface RayenSyncCoverageIssue {
  bedId: string;
  source: RayenSyncIssueSource;
  reason: RayenSyncIssueReason;
}

export type RayenSyncFailureReason =
  | 'extension_unavailable'
  | 'extension_incompatible'
  | 'ficha_medico_unavailable'
  | 'gestion_camas_unavailable'
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
  /** Actionable, privacy-safe diagnostics for recent synchronization runs. */
  issues?: RayenSyncCoverageIssue[];
  /** Aggregate-only incremental evidence. No patient, professional or clinical values are stored. */
  incremental?: {
    received: number;
    newFacts: number;
    duplicates: number;
    corrections: number;
    patientWrites: number;
    historySnapshots: number;
    clinicalTargets?: number;
    checkpointOnlyTargets?: number;
    batch?: {
      mode: 'shadow' | 'enforced';
      parity: 'matched' | 'mismatch' | 'unavailable';
      clinicalTargets: number;
      checkpointOnlyTargets: number;
      checkpointTargets: number;
      requestedFields: number;
      backendTargets?: number;
      backendFields?: number;
    };
  };
  completedAt: string;
}

export interface RayenSyncChanges {
  admissions: number;
  updates: number;
  moves: number;
  discharges: number;
  unchanged: number;
}

export type RayenStaffingSection = 'nurse_day' | 'nurse_night' | 'tens_day' | 'tens_night';

export interface RayenStaffingBoundaryExclusion {
  section: RayenStaffingSection;
  name: string;
  role: string;
  recordedAt: string;
  source:
    | 'evolution'
    | 'shift-change'
    | 'evaluation-scale'
    | 'medication-administration'
    | 'vital-signs';
  boundary: 'day_start' | 'night_start' | 'night_end';
}

/** Privacy-safe explanation for a staffing proposal that HHR deliberately did not auto-apply. */
export interface RayenSyncStaffingObservation {
  ambiguousSections: RayenStaffingSection[];
  ignoredBoundaryRecords: number;
  /** Concrete evidence behind the aggregate counter; absent on legacy synchronization events. */
  ignoredBoundaryEvidence?: RayenStaffingBoundaryExclusion[];
}

export interface RayenSyncSource {
  extensionVersion?: string;
  protocolVersion?: number;
  fichaMedico?: RayenExtensionEndpointStatus;
  gestionCamas?: RayenExtensionEndpointStatus;
}

/** Aggregate physician-source evidence. Names and stable practitioner ids are never persisted. */
export interface RayenTreatingPhysicianSourceQuality {
  encounters: number;
  catalogEntries: number;
  assignedEncounters: number;
  sourceResolvedNames: number;
  plannedResolvedNames: number;
}

export type RayenClinicalPersistenceScope = 'current' | 'historical';

/** Aggregate-only authority-call evidence. It never contains record or patient identifiers. */
export interface RayenClinicalPersistenceTrace {
  callableAttempts: number;
  clientRetries: number;
  transactionRetries: number;
}

/** Aggregate-only performance evidence. It must never contain patient or clinical identifiers. */
export interface RayenSyncPerformance {
  stagesMs: Partial<{
    preflight: number;
    dualCapture: number;
    reconciliation: number;
    historicalEvidence: number;
    reviewWait: number;
    structuralPersistence: number;
    clinicalReads: number;
    writeQueueWait: number;
    persistence: number;
    currentClinicalPersistence: number;
    historicalCudyrPersistence: number;
  }>;
  counters: {
    requests: number;
    cacheHits: number;
    patches: number;
    retries: number;
    timeouts: number;
    /** CUDYR proposals intentionally omitted because an administrative correction owns the value. */
    administrativeOverridesPreserved?: number;
  };
  sourceQuality?: {
    treatingPhysicians?: RayenTreatingPhysicianSourceQuality;
  };
  /** Counts authority calls and retries independently for current and historical writes. */
  persistenceTrace?: Partial<Record<RayenClinicalPersistenceScope, RayenClinicalPersistenceTrace>>;
  /** Aggregate coordination evidence; never includes dates, beds or episode identifiers. */
  coordination?: {
    target?: 'current' | 'historical';
    structuralReplans: number;
    confirmedEpisodes: number;
    omittedEpisodes: number;
    clinicalRetries: number;
  };
}

export interface RayenSyncPerformanceDelta {
  stagesMs?: RayenSyncPerformance['stagesMs'];
  counters?: Partial<RayenSyncPerformance['counters']>;
  sourceQuality?: RayenSyncPerformance['sourceQuality'];
  persistenceTrace?: RayenSyncPerformance['persistenceTrace'];
  coordination?: Partial<NonNullable<RayenSyncPerformance['coordination']>>;
}

/** Aggregate-only structural evidence retained when clinical enrichment can still complete. */
export interface RayenSyncStructuralReviewEvidence {
  /** Explicit proof that the structural census reached an authoritative confirmed handoff. */
  structureConfirmed?: boolean;
  historicalCorrectionsPending: boolean;
  historicalCorrectionsRequireFreshCapture: boolean;
  isolatedConflicts: number;
  /** Bed-only traceability for optional D-1 backfills that were safely omitted. */
  deferredHistoricalAdmissionBedIds?: string[];
  /** Bed and reason category for recent runs; absent on legacy events. */
  issues?: RayenSyncStructuralIssue[];
}

export interface RayenSyncEvent {
  /** Stable run id. Updating a run replaces this event instead of appending a duplicate. */
  id: string;
  /** Daily record that owns this run; absent only on events created before schema v2. */
  sourceDate?: string;
  startedAt: string;
  completedAt?: string;
  by: string;
  status: RayenSyncStatus;
  coverage?: RayenSyncCoverage;
  changes?: RayenSyncChanges;
  source?: RayenSyncSource;
  policy?: RayenSyncPolicy;
  staffingObservation?: RayenSyncStaffingObservation;
  /** Structural review facts kept separate from clinical coverage and free of identifiers. */
  structuralReview?: RayenSyncStructuralReviewEvidence;
  /** Technical aggregate shown only in synchronization history and diagnostics. */
  performance?: RayenSyncPerformance;
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
  staffingObservation?: RayenSyncStaffingObservation;
}
