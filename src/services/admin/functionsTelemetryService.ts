/**
 * Functions Telemetry Service
 * Reads telemetry entries written by netlify/functions/lib/observability.ts.
 * Collection is append-only (Firestore rules enforce deny update/delete).
 */

import { firestoreDb } from '@/services/storage/firestore';
import { getActiveHospitalId } from '@/constants/firestorePaths';
import type {
  DailyRecordAuthorityRolloutRecommendation,
  DailyRecordAuthorityRolloutSummary,
  FunctionsTelemetryEntry,
  FunctionsTelemetryServiceSummary,
  RayenClinicalEnrichmentRolloutRecommendation,
  RayenClinicalEnrichmentRolloutSummary,
} from '@/types/functionsTelemetry';

const COLLECTION_PATH = () => `hospitals/${getActiveHospitalId()}/functionsTelemetry`;

const DEFAULT_LIMIT = 500;
const DAILY_RECORD_AUTHORITY_SERVICE = 'dailyRecordWriteAuthority';
const DAILY_RECORD_AUTHORITY_OPERATIONS = new Set([
  'saveDailyRecordWithClinicalAuthority',
  'patchDailyRecordWithClinicalAuthority',
]);
const RAYEN_CLINICAL_ENRICHMENT_SERVICE = 'rayenClinicalEnrichment';
const RAYEN_CLINICAL_ENRICHMENT_OPERATION = 'applyRayenClinicalEnrichmentBatch';
const MIN_MATCHED_SHADOW_RUNS = 4;
const MIN_SHADOW_EVIDENCE_HOURS = 8;

interface RawTelemetryRecord {
  id?: string;
  service?: string;
  operation?: string;
  hospitalId?: string;
  durationMs?: number;
  attempt?: number;
  totalAttempts?: number;
  status?: string;
  errorCode?: string;
  errorMessage?: string;
  context?: Record<string, unknown>;
  timestamp?: string;
}

const normalizeEntry = (raw: RawTelemetryRecord & { id: string }): FunctionsTelemetryEntry => ({
  id: raw.id,
  service: raw.service ?? 'unknown',
  operation: raw.operation ?? 'unknown',
  hospitalId: raw.hospitalId,
  durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : 0,
  attempt: typeof raw.attempt === 'number' ? raw.attempt : 1,
  totalAttempts: typeof raw.totalAttempts === 'number' ? raw.totalAttempts : 1,
  status:
    raw.status === 'success' || raw.status === 'failure' || raw.status === 'timeout'
      ? raw.status
      : 'failure',
  errorCode: raw.errorCode,
  errorMessage: raw.errorMessage,
  context: raw.context as FunctionsTelemetryEntry['context'],
  timestamp: raw.timestamp ?? new Date().toISOString(),
});

export const fetchFunctionsTelemetry = async (
  limitCount: number = DEFAULT_LIMIT
): Promise<FunctionsTelemetryEntry[]> => {
  const rows = await firestoreDb.getDocs<RawTelemetryRecord & { id: string }>(COLLECTION_PATH(), {
    orderBy: [{ field: 'timestamp', direction: 'desc' }],
    limit: limitCount,
  });
  return rows.map(normalizeEntry);
};

export const buildServiceSummaries = (
  entries: FunctionsTelemetryEntry[]
): FunctionsTelemetryServiceSummary[] => {
  const groups = new Map<string, FunctionsTelemetryEntry[]>();
  for (const entry of entries) {
    const bucket = groups.get(entry.service) || [];
    bucket.push(entry);
    groups.set(entry.service, bucket);
  }

  const summaries: FunctionsTelemetryServiceSummary[] = [];
  for (const [service, bucket] of groups.entries()) {
    const total = bucket.length;
    const successes = bucket.filter(e => e.status === 'success').length;
    const failures = bucket.filter(e => e.status === 'failure').length;
    const timeouts = bucket.filter(e => e.status === 'timeout').length;
    const errorRate = total > 0 ? (failures + timeouts) / total : 0;
    const avgDurationMs =
      total > 0 ? Math.round(bucket.reduce((sum, e) => sum + e.durationMs, 0) / total) : 0;
    const lastEntryAt = bucket
      .map(e => e.timestamp)
      .sort()
      .slice(-1)[0];

    summaries.push({
      service,
      total,
      successes,
      failures,
      timeouts,
      errorRate,
      avgDurationMs,
      lastEntryAt,
    });
  }

  return summaries.sort((a, b) => b.errorRate - a.errorRate || b.total - a.total);
};

const readNumberContext = (context: FunctionsTelemetryEntry['context'], key: string): number => {
  const value = context?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

const readStringContext = (context: FunctionsTelemetryEntry['context'], key: string): string => {
  const value = context?.[key];
  return typeof value === 'string' ? value : '';
};

const isDailyRecordAuthorityEntry = (entry: FunctionsTelemetryEntry): boolean =>
  entry.service === DAILY_RECORD_AUTHORITY_SERVICE &&
  DAILY_RECORD_AUTHORITY_OPERATIONS.has(entry.operation);

const resolveAuthorityRolloutRecommendation = (
  summary: Omit<DailyRecordAuthorityRolloutSummary, 'recommendation'>
): DailyRecordAuthorityRolloutRecommendation => {
  if (summary.total === 0) {
    return 'insufficient_data';
  }

  if (
    summary.failureCount > 0 ||
    summary.blockedCount > 0 ||
    summary.permissionDeniedCount > 0 ||
    summary.degenerateFallbackEpisodeKeys > 0
  ) {
    return 'investigate';
  }

  if (summary.enforcedWrites > 0) {
    return 'monitor_enforced';
  }

  return 'ready_for_enforced';
};

export const buildDailyRecordAuthorityRolloutSummary = (
  entries: FunctionsTelemetryEntry[]
): DailyRecordAuthorityRolloutSummary => {
  const authorityEntries = entries.filter(isDailyRecordAuthorityEntry);
  const base = authorityEntries.reduce(
    (summary, entry) => {
      const mode = readStringContext(entry.context, 'mode');
      const authorityStatus = readStringContext(entry.context, 'authorityStatus');
      return {
        total: summary.total + 1,
        shadowRuns: summary.shadowRuns + (mode === 'shadow' ? 1 : 0),
        enforcedWrites: summary.enforcedWrites + (mode === 'enforced' ? 1 : 0),
        successCount: summary.successCount + (entry.status === 'success' ? 1 : 0),
        failureCount: summary.failureCount + (entry.status === 'failure' ? 1 : 0),
        blockedCount:
          summary.blockedCount +
          (authorityStatus === 'blocked' || entry.errorCode === 'failed-precondition' ? 1 : 0),
        permissionDeniedCount:
          summary.permissionDeniedCount + (entry.errorCode === 'permission-denied' ? 1 : 0),
        fallbackEpisodeKeys:
          summary.fallbackEpisodeKeys + readNumberContext(entry.context, 'fallbackEpisodeKeys'),
        degenerateFallbackEpisodeKeys:
          summary.degenerateFallbackEpisodeKeys +
          readNumberContext(entry.context, 'degenerateFallbackEpisodeKeys'),
        lastEntryAt:
          !summary.lastEntryAt || entry.timestamp > summary.lastEntryAt
            ? entry.timestamp
            : summary.lastEntryAt,
      };
    },
    {
      total: 0,
      shadowRuns: 0,
      enforcedWrites: 0,
      successCount: 0,
      failureCount: 0,
      blockedCount: 0,
      permissionDeniedCount: 0,
      fallbackEpisodeKeys: 0,
      degenerateFallbackEpisodeKeys: 0,
      lastEntryAt: undefined as string | undefined,
    }
  );

  return {
    ...base,
    recommendation: resolveAuthorityRolloutRecommendation(base),
  };
};

const resolveClinicalEnrichmentRecommendation = (
  summary: Omit<RayenClinicalEnrichmentRolloutSummary, 'recommendation'>
): RayenClinicalEnrichmentRolloutRecommendation => {
  if (summary.total === 0) return 'insufficient_data';
  if (
    summary.failureCount > 0 ||
    summary.blockedCount > 0 ||
    summary.permissionDeniedCount > 0 ||
    summary.mismatchedShadowRuns > 0
  ) {
    return 'investigate';
  }
  if (summary.enforcedWrites > 0) return 'monitor_enforced';
  if (
    summary.matchedShadowRuns >= MIN_MATCHED_SHADOW_RUNS &&
    summary.unavailableShadowRuns === 0 &&
    summary.evidenceHours >= MIN_SHADOW_EVIDENCE_HOURS
  ) {
    return 'ready_for_enforced';
  }
  return 'insufficient_data';
};

export const buildRayenClinicalEnrichmentRolloutSummary = (
  entries: FunctionsTelemetryEntry[]
): RayenClinicalEnrichmentRolloutSummary => {
  const batchEntries = entries.filter(
    entry =>
      entry.service === RAYEN_CLINICAL_ENRICHMENT_SERVICE &&
      entry.operation === RAYEN_CLINICAL_ENRICHMENT_OPERATION
  );
  const timestamps = batchEntries
    .map(entry => Date.parse(entry.timestamp))
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  const firstTimestamp = timestamps[0];
  const lastTimestamp = timestamps.at(-1);
  const evidenceHours =
    firstTimestamp != null && lastTimestamp != null
      ? Math.floor((lastTimestamp - firstTimestamp) / 3_600_000)
      : 0;
  const base = batchEntries.reduce(
    (summary, entry) => {
      const mode = readStringContext(entry.context, 'mode');
      const parity = readStringContext(entry.context, 'resultParity');
      const authorityStatus = readStringContext(entry.context, 'authorityStatus');
      const shadow = mode === 'shadow';
      return {
        total: summary.total + 1,
        shadowRuns: summary.shadowRuns + (shadow ? 1 : 0),
        enforcedWrites: summary.enforcedWrites + (mode === 'enforced' ? 1 : 0),
        matchedShadowRuns: summary.matchedShadowRuns + (shadow && parity === 'matched' ? 1 : 0),
        mismatchedShadowRuns:
          summary.mismatchedShadowRuns + (shadow && parity === 'mismatch' ? 1 : 0),
        unavailableShadowRuns:
          summary.unavailableShadowRuns +
          (shadow && parity !== 'matched' && parity !== 'mismatch' ? 1 : 0),
        failureCount: summary.failureCount + (entry.status === 'failure' ? 1 : 0),
        blockedCount:
          summary.blockedCount +
          (authorityStatus === 'blocked' || entry.errorCode === 'failed-precondition' ? 1 : 0),
        permissionDeniedCount:
          summary.permissionDeniedCount + (entry.errorCode === 'permission-denied' ? 1 : 0),
      };
    },
    {
      total: 0,
      shadowRuns: 0,
      enforcedWrites: 0,
      matchedShadowRuns: 0,
      mismatchedShadowRuns: 0,
      unavailableShadowRuns: 0,
      failureCount: 0,
      blockedCount: 0,
      permissionDeniedCount: 0,
    }
  );
  const summary = {
    ...base,
    evidenceHours,
    firstEntryAt: firstTimestamp != null ? new Date(firstTimestamp).toISOString() : undefined,
    lastEntryAt: lastTimestamp != null ? new Date(lastTimestamp).toISOString() : undefined,
  };
  return { ...summary, recommendation: resolveClinicalEnrichmentRecommendation(summary) };
};
