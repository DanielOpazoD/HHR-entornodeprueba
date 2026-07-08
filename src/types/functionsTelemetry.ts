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

export type DailyRecordAuthorityRolloutRecommendation =
  | 'insufficient_data'
  | 'ready_for_enforced'
  | 'monitor_enforced'
  | 'investigate';

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

export interface FunctionsTelemetryFilters {
  service?: string;
  status?: TelemetryStatus;
  since?: string; // ISO 8601, inclusive
  search?: string; // free text: operation, errorCode, errorMessage
}
