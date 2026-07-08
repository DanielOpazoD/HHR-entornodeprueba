import type {
  SystemHealthIncidentResolution,
  SystemHealthIncidentResolutionHistoryEntry,
  SystemHealthIncidentResolutionState,
  UserHealthRecentEvent,
  UserHealthStatus,
  VersionUpdateReason,
} from '@/services/admin/healthService.contracts';
import type { OperationalTelemetryStatus } from '@/services/observability/operationalTelemetryTypes';
import type { OperationalRuntimeState } from '@/services/observability/operationalRuntimeState';
import type { FirestoreSyncReason } from '@/services/repositories/repositoryConfig';

const toNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBoolean = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback;

const toStringValue = (value: unknown, fallback = ''): string =>
  typeof value === 'string' && value.trim().length > 0 ? value : fallback;

const validRemoteSyncReasons = new Set<FirestoreSyncReason>([
  'ready',
  'auth_loading',
  'auth_connecting',
  'auth_unavailable',
  'manual_override',
  'offline',
  'runtime_unavailable',
]);

const validVersionUpdateReasons = new Set<VersionUpdateReason>([
  'current',
  'new_build_available',
  'runtime_contract_mismatch',
  'schema_ahead_of_client',
]);

const validOperationalRuntimeStates = new Set<OperationalRuntimeState>([
  'retryable',
  'recoverable',
  'degraded',
  'blocked',
  'unauthorized',
]);

const validOperationalTelemetryStatuses = new Set<OperationalTelemetryStatus>([
  'success',
  'partial',
  'degraded',
  'failed',
]);

const validRecentEventSources = new Set<UserHealthRecentEvent['source']>([
  'local_error',
  'operational',
  'sync_conflict',
  'health_snapshot',
]);

const validRecentEventCategories = new Set<UserHealthRecentEvent['category']>([
  'auth',
  'daily_record',
  'firestore',
  'sync',
  'indexeddb',
  'integration',
  'export',
  'backup',
  'reminders',
  'transfers',
  'clinical_document',
  'create_day',
  'handoff',
  'prescription',
  'local_error',
  'sync_conflict',
  'health_snapshot',
]);

const validRecentEventSeverity = new Set<UserHealthRecentEvent['severity']>([
  'info',
  'warning',
  'critical',
]);

const validRecentEventStatus = new Set<UserHealthRecentEvent['status']>([
  'open',
  'recovered',
  'resolved',
]);

const normalizeStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

const normalizeRecentEvent = (raw: unknown): UserHealthRecentEvent | null => {
  if (!raw || typeof raw !== 'object') return null;
  const event = raw as Partial<UserHealthRecentEvent>;
  const id = toStringValue(event.id);
  const timestamp = toStringValue(event.timestamp);
  const message = toStringValue(event.message);

  if (!id || !timestamp || !message) return null;

  return {
    id,
    source: validRecentEventSources.has(event.source as UserHealthRecentEvent['source'])
      ? (event.source as UserHealthRecentEvent['source'])
      : 'health_snapshot',
    category: validRecentEventCategories.has(event.category as UserHealthRecentEvent['category'])
      ? (event.category as UserHealthRecentEvent['category'])
      : 'health_snapshot',
    severity: validRecentEventSeverity.has(event.severity as UserHealthRecentEvent['severity'])
      ? (event.severity as UserHealthRecentEvent['severity'])
      : 'warning',
    status: validRecentEventStatus.has(event.status as UserHealthRecentEvent['status'])
      ? (event.status as UserHealthRecentEvent['status'])
      : 'open',
    timestamp,
    message,
    operation: toStringValue(event.operation),
    module: toStringValue(event.module),
    action: toStringValue(event.action),
    route: toStringValue(event.route),
    runtimeState: validOperationalRuntimeStates.has(event.runtimeState as OperationalRuntimeState)
      ? event.runtimeState
      : undefined,
    telemetryStatus: validOperationalTelemetryStatuses.has(
      event.telemetryStatus as OperationalTelemetryStatus
    )
      ? event.telemetryStatus
      : undefined,
    issues: normalizeStringList(event.issues),
    contextSummary: normalizeStringList(event.contextSummary),
  };
};

const normalizeRecentEvents = (value: unknown): UserHealthRecentEvent[] =>
  Array.isArray(value)
    ? value
        .map(normalizeRecentEvent)
        .filter((event): event is UserHealthRecentEvent => event !== null)
        .slice(0, 12)
    : [];

const normalizeResolutionHistory = (
  value: unknown
): SystemHealthIncidentResolutionHistoryEntry[] =>
  Array.isArray(value)
    ? value
        .map((entry): SystemHealthIncidentResolutionHistoryEntry | null => {
          if (!entry || typeof entry !== 'object') return null;
          const candidate = entry as Partial<SystemHealthIncidentResolutionHistoryEntry>;
          const action =
            candidate.action === 'resolved' || candidate.action === 'reopened'
              ? candidate.action
              : null;
          const at = toStringValue(candidate.at);
          if (!action || !at) return null;
          return {
            action,
            at,
            actorUid: toStringValue(candidate.actorUid),
            actorEmail: toStringValue(candidate.actorEmail),
            actorName: toStringValue(candidate.actorName),
            note: toStringValue(candidate.note),
          };
        })
        .filter((entry): entry is SystemHealthIncidentResolutionHistoryEntry => entry !== null)
        .slice(0, 20)
    : [];

export const normalizeSystemHealthIncidentResolution = (
  raw: unknown
): SystemHealthIncidentResolution | null => {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<SystemHealthIncidentResolution>;
  const resolutionKey = toStringValue(value.resolutionKey);
  if (!resolutionKey) return null;

  const status = value.status === 'resolved' ? 'resolved' : 'open';
  const updatedAt = toStringValue(value.updatedAt, new Date(0).toISOString());

  return {
    resolutionKey,
    status,
    updatedAt,
    resolvedAt: toStringValue(value.resolvedAt),
    resolvedByUid: toStringValue(value.resolvedByUid),
    resolvedByEmail: toStringValue(value.resolvedByEmail),
    resolvedByName: toStringValue(value.resolvedByName),
    reopenedAt: toStringValue(value.reopenedAt),
    reopenedByUid: toStringValue(value.reopenedByUid),
    reopenedByEmail: toStringValue(value.reopenedByEmail),
    reopenedByName: toStringValue(value.reopenedByName),
    note: toStringValue(value.note),
    history: normalizeResolutionHistory(value.history),
  };
};

export const normalizeSystemHealthIncidentResolutionState = (
  values: unknown[]
): SystemHealthIncidentResolutionState =>
  Object.fromEntries(
    values
      .map(normalizeSystemHealthIncidentResolution)
      .filter((resolution): resolution is SystemHealthIncidentResolution => resolution !== null)
      .map(resolution => [resolution.resolutionKey, resolution])
  );

export const normalizeUserHealthStatus = (raw: Partial<UserHealthStatus>): UserHealthStatus => ({
  uid: toStringValue(raw.uid, 'unknown'),
  email: toStringValue(raw.email, 'unknown@local'),
  displayName: toStringValue(raw.displayName, 'Usuario sin nombre'),
  lastSeen: toStringValue(raw.lastSeen, new Date(0).toISOString()),
  isOnline: toBoolean(raw.isOnline, false),
  isOutdated: toBoolean(raw.isOutdated, false),
  pendingMutations: toNumber(raw.pendingMutations),
  pendingSyncTasks: toNumber(raw.pendingSyncTasks),
  failedSyncTasks: toNumber(raw.failedSyncTasks),
  conflictSyncTasks: toNumber(raw.conflictSyncTasks),
  retryingSyncTasks: toNumber(raw.retryingSyncTasks),
  syncOrphanedTasks: toNumber(raw.syncOrphanedTasks),
  oldestPendingAgeMs: toNumber(raw.oldestPendingAgeMs),
  oldestDirectQueueAgeMs: toNumber(raw.oldestDirectQueueAgeMs),
  remoteSyncReason: validRemoteSyncReasons.has(raw.remoteSyncReason as FirestoreSyncReason)
    ? raw.remoteSyncReason
    : undefined,
  versionUpdateReason: validVersionUpdateReasons.has(raw.versionUpdateReason as VersionUpdateReason)
    ? raw.versionUpdateReason
    : undefined,
  localErrorCount: toNumber(raw.localErrorCount),
  degradedLocalPersistence: toBoolean(raw.degradedLocalPersistence, false),
  repositoryWarningCount: toNumber(raw.repositoryWarningCount),
  slowestRepositoryOperationMs: toNumber(raw.slowestRepositoryOperationMs),
  operationalObservedCount: toNumber(raw.operationalObservedCount),
  operationalFailureCount: toNumber(raw.operationalFailureCount),
  operationalRetryableCount: toNumber(raw.operationalRetryableCount),
  operationalRecoverableCount: toNumber(raw.operationalRecoverableCount),
  operationalDegradedCount: toNumber(raw.operationalDegradedCount),
  operationalBlockedCount: toNumber(raw.operationalBlockedCount),
  operationalUnauthorizedCount: toNumber(raw.operationalUnauthorizedCount),
  operationalLastHourObservedCount: toNumber(raw.operationalLastHourObservedCount),
  operationalSyncObservedCount: toNumber(raw.operationalSyncObservedCount),
  operationalIndexedDbObservedCount: toNumber(raw.operationalIndexedDbObservedCount),
  operationalClinicalDocumentObservedCount: toNumber(raw.operationalClinicalDocumentObservedCount),
  operationalCreateDayObservedCount: toNumber(raw.operationalCreateDayObservedCount),
  operationalHandoffObservedCount: toNumber(raw.operationalHandoffObservedCount),
  operationalExportBackupObservedCount: toNumber(raw.operationalExportBackupObservedCount),
  operationalDailyRecordRecoveredRealtimeNullCount: toNumber(
    raw.operationalDailyRecordRecoveredRealtimeNullCount
  ),
  operationalDailyRecordConfirmedRealtimeNullCount: toNumber(
    raw.operationalDailyRecordConfirmedRealtimeNullCount
  ),
  operationalSyncReadUnavailableCount: toNumber(raw.operationalSyncReadUnavailableCount),
  operationalIndexedDbFallbackModeCount: toNumber(raw.operationalIndexedDbFallbackModeCount),
  operationalAuthBootstrapTimeoutCount: toNumber(raw.operationalAuthBootstrapTimeoutCount),
  operationalTopObservedCategory:
    typeof raw.operationalTopObservedCategory === 'string'
      ? raw.operationalTopObservedCategory
      : undefined,
  operationalTopObservedOperation:
    typeof raw.operationalTopObservedOperation === 'string'
      ? raw.operationalTopObservedOperation
      : undefined,
  latestOperationalOperation:
    typeof raw.latestOperationalOperation === 'string' ? raw.latestOperationalOperation : undefined,
  latestOperationalRuntimeState: validOperationalRuntimeStates.has(
    raw.latestOperationalRuntimeState as OperationalRuntimeState
  )
    ? raw.latestOperationalRuntimeState
    : undefined,
  latestOperationalIssueAt:
    typeof raw.latestOperationalIssueAt === 'string' ? raw.latestOperationalIssueAt : undefined,
  recentEvents: normalizeRecentEvents(raw.recentEvents),
  appVersion: toStringValue(raw.appVersion, 'unknown'),
  platform: toStringValue(raw.platform, 'unknown'),
  userAgent: toStringValue(raw.userAgent, 'unknown'),
});
