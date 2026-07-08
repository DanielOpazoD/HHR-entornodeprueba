import type { OperationalRuntimeState } from '@/services/observability/operationalRuntimeState';
import type {
  OperationalTelemetryCategory,
  OperationalTelemetryStatus,
} from '@/services/observability/operationalTelemetryTypes';
import type { FirestoreSyncReason } from '@/services/repositories/repositoryConfig';

export type VersionUpdateReason =
  | 'current'
  | 'new_build_available'
  | 'runtime_contract_mismatch'
  | 'schema_ahead_of_client';

export type UserHealthEventSource =
  | 'local_error'
  | 'operational'
  | 'sync_conflict'
  | 'health_snapshot';

export type UserHealthEventSeverity = 'info' | 'warning' | 'critical';

export type UserHealthEventStatus = 'open' | 'recovered' | 'resolved';

export interface UserHealthRecentEvent {
  id: string;
  source: UserHealthEventSource;
  category: OperationalTelemetryCategory | 'local_error' | 'sync_conflict' | 'health_snapshot';
  severity: UserHealthEventSeverity;
  status: UserHealthEventStatus;
  timestamp: string;
  message: string;
  operation?: string;
  module?: string;
  action?: string;
  route?: string;
  runtimeState?: OperationalRuntimeState;
  telemetryStatus?: OperationalTelemetryStatus;
  issues?: string[];
  contextSummary?: string[];
}

export interface UserHealthStatus {
  uid: string;
  email: string;
  displayName: string;
  lastSeen: string;
  isOnline: boolean;
  isOutdated: boolean;
  pendingMutations: number;
  pendingSyncTasks: number;
  failedSyncTasks: number;
  conflictSyncTasks: number;
  retryingSyncTasks: number;
  syncOrphanedTasks?: number;
  oldestPendingAgeMs: number;
  oldestDirectQueueAgeMs?: number;
  remoteSyncReason?: FirestoreSyncReason;
  versionUpdateReason?: VersionUpdateReason;
  localErrorCount: number;
  degradedLocalPersistence: boolean;
  repositoryWarningCount: number;
  slowestRepositoryOperationMs: number;
  operationalObservedCount: number;
  operationalFailureCount: number;
  operationalRetryableCount: number;
  operationalRecoverableCount: number;
  operationalDegradedCount: number;
  operationalBlockedCount: number;
  operationalUnauthorizedCount: number;
  operationalLastHourObservedCount: number;
  operationalSyncObservedCount: number;
  operationalIndexedDbObservedCount: number;
  operationalClinicalDocumentObservedCount: number;
  operationalCreateDayObservedCount: number;
  operationalHandoffObservedCount: number;
  operationalExportBackupObservedCount: number;
  operationalDailyRecordRecoveredRealtimeNullCount?: number;
  operationalDailyRecordConfirmedRealtimeNullCount?: number;
  operationalSyncReadUnavailableCount?: number;
  operationalIndexedDbFallbackModeCount?: number;
  operationalAuthBootstrapTimeoutCount?: number;
  operationalTopObservedCategory?: string;
  operationalTopObservedOperation?: string;
  latestOperationalOperation?: string;
  latestOperationalRuntimeState?: OperationalRuntimeState;
  latestOperationalIssueAt?: string;
  recentEvents?: UserHealthRecentEvent[];
  appVersion: string;
  platform: string;
  userAgent: string;
}

export type SystemHealthIncidentResolutionStatus = 'open' | 'resolved';

export interface SystemHealthIncidentResolutionHistoryEntry {
  action: 'resolved' | 'reopened';
  at: string;
  actorUid?: string;
  actorEmail?: string;
  actorName?: string;
  note?: string;
}

export interface SystemHealthIncidentResolution {
  resolutionKey: string;
  status: SystemHealthIncidentResolutionStatus;
  updatedAt: string;
  resolvedAt?: string;
  resolvedByUid?: string;
  resolvedByEmail?: string;
  resolvedByName?: string;
  reopenedAt?: string;
  reopenedByUid?: string;
  reopenedByEmail?: string;
  reopenedByName?: string;
  note?: string;
  history: SystemHealthIncidentResolutionHistoryEntry[];
}

export type SystemHealthIncidentResolutionState = Record<string, SystemHealthIncidentResolution>;

export interface SystemHealthIncidentResolutionActor {
  uid?: string;
  email?: string | null;
  displayName?: string | null;
}

export interface SystemHealthSummary {
  totalUsers: number;
  onlineUsers: number;
  offlineUsers: number;
  outdatedUsers: number;
  degradedLocalPersistenceUsers: number;
  usersWithRepositoryWarnings: number;
  usersWithSyncFailures: number;
  totalPendingSyncTasks: number;
  totalFailedSyncTasks: number;
  totalConflictSyncTasks: number;
  totalSyncOrphanedTasks: number;
  totalLocalErrorCount: number;
  totalRepositoryWarnings: number;
  maxSlowRepositoryOperationMs: number;
  oldestObservedPendingAgeMs: number;
  totalOperationalObservedCount: number;
  totalOperationalFailureCount: number;
  totalOperationalRetryableCount: number;
  totalOperationalRecoverableCount: number;
  totalOperationalDegradedCount: number;
  totalOperationalBlockedCount: number;
  totalOperationalUnauthorizedCount: number;
  totalOperationalLastHourObservedCount: number;
  totalOperationalSyncObservedCount: number;
  totalOperationalIndexedDbObservedCount: number;
  totalOperationalClinicalDocumentObservedCount: number;
  totalOperationalCreateDayObservedCount: number;
  totalOperationalHandoffObservedCount: number;
  totalOperationalExportBackupObservedCount: number;
  totalOperationalDailyRecordRecoveredRealtimeNullCount: number;
  totalOperationalDailyRecordConfirmedRealtimeNullCount: number;
  totalOperationalSyncReadUnavailableCount: number;
  totalOperationalIndexedDbFallbackModeCount: number;
  totalOperationalAuthBootstrapTimeoutCount: number;
  usersWithSyncOwnershipDrift: number;
  usersWithRuntimeContractMismatch: number;
  usersWithSchemaAheadClient: number;
  topOperationalCategory?: string;
  topOperationalOperation?: string;
  topOperationalRuntimeState?: OperationalRuntimeState;
  usersWithRecentOperationalIssues: number;
  latestOperationalIssueAt?: string;
}
