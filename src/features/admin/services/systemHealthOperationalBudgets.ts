import { SYNC_QUEUE_RUNTIME_THRESHOLDS } from '@/services/storage/sync/syncQueueOperationalBudgets';

export interface SystemHealthThresholds {
  warningOldestPendingAgeMs: number;
  criticalOldestPendingAgeMs: number;
  warningRetryingSyncTasks: number;
  criticalRetryingSyncTasks: number;
  warningPendingMutations: number;
  criticalPendingMutations: number;
  warningLocalErrorCount: number;
  criticalLocalErrorCount: number;
  warningRepositoryWarningCount: number;
  criticalRepositoryWarningCount: number;
  warningSlowRepositoryOperationMs: number;
  criticalSlowRepositoryOperationMs: number;
}

export const DEFAULT_SYSTEM_HEALTH_THRESHOLDS: SystemHealthThresholds = {
  warningOldestPendingAgeMs: SYNC_QUEUE_RUNTIME_THRESHOLDS.warningOldestPendingAgeMs,
  criticalOldestPendingAgeMs: SYNC_QUEUE_RUNTIME_THRESHOLDS.criticalOldestPendingAgeMs,
  warningRetryingSyncTasks: SYNC_QUEUE_RUNTIME_THRESHOLDS.warningRetryingSyncTasks,
  criticalRetryingSyncTasks: SYNC_QUEUE_RUNTIME_THRESHOLDS.criticalRetryingSyncTasks,
  warningPendingMutations: 1,
  criticalPendingMutations: 8,
  warningLocalErrorCount: 1,
  criticalLocalErrorCount: 15,
  warningRepositoryWarningCount: 1,
  criticalRepositoryWarningCount: 5,
  warningSlowRepositoryOperationMs: 350,
  criticalSlowRepositoryOperationMs: 800,
};

export const PROLONGED_OFFLINE_USER_AGE_MS = 900000;
