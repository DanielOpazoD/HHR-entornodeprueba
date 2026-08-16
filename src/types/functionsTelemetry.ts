/**
 * Types for Functions telemetry (written by netlify/functions/lib/observability.ts).
 * Stored in Firestore at `hospitals/{hospitalId}/functionsTelemetry/{autoId}`, append-only.
 */

export type TelemetryStatus = 'success' | 'failure' | 'timeout';

export type TelemetryContextValue = string | number | boolean;

export interface FunctionsTelemetryEntry {
  id: string;
  service: string;
  operation: string;
  hospitalId?: string;
  durationMs: number;
  attempt: number;
  totalAttempts: number;
  status: TelemetryStatus;
  errorCode?: string;
  errorMessage?: string;
  context?: Record<string, TelemetryContextValue>;
  timestamp: string; // ISO 8601
}

export interface FunctionsTelemetryServiceSummary {
  service: string;
  total: number;
  successes: number;
  failures: number;
  timeouts: number;
  errorRate: number; // 0..1
  avgDurationMs: number;
  lastEntryAt?: string;
}

export type RolloutRecommendation =
  | 'insufficient_data'
  | 'ready_for_enforced'
  | 'monitor_enforced'
  | 'investigate';

export type DailyRecordAuthorityRolloutRecommendation = RolloutRecommendation;

export interface DailyRecordAuthorityRolloutSummary {
  total: number;
  shadowRuns: number;
  enforcedWrites: number;
  successCount: number;
  failureCount: number;
  blockedCount: number;
  permissionDeniedCount: number;
  fallbackEpisodeKeys: number;
  degenerateFallbackEpisodeKeys: number;
  lastEntryAt?: string;
  recommendation: DailyRecordAuthorityRolloutRecommendation;
}

export type RayenClinicalEnrichmentRolloutRecommendation = RolloutRecommendation;

export interface RayenClinicalEnrichmentRolloutSummary {
  parityContractVersion: number;
  /** Complete audit totals for the active parity contract. */
  total: number;
  shadowRuns: number;
  enforcedWrites: number;
  matchedShadowRuns: number;
  mismatchedShadowRuns: number;
  unavailableShadowRuns: number;
  failureCount: number;
  blockedCount: number;
  permissionDeniedCount: number;
  evidenceHours: number;
  firstEntryAt?: string;
  lastEntryAt?: string;
  /** Consecutive non-blocking evidence after the latest mismatch or operational failure. */
  cleanWindowRuns: number;
  cleanMatchedShadowRuns: number;
  cleanEnforcedWrites: number;
  cleanEvidenceHours: number;
  lastBlockingSignalAt?: string;
  recommendation: RayenClinicalEnrichmentRolloutRecommendation;
}

export interface FunctionsTelemetryFilters {
  service?: string;
  status?: TelemetryStatus;
  since?: string; // ISO 8601, inclusive
  search?: string; // free text: operation, errorCode, errorMessage
}
