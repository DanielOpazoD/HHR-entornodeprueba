import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { SyncQueueTelemetry } from '@/services/storage/sync/syncQueueTelemetryContracts';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import type { OperationalRuntimeState } from '@/services/observability/operationalRuntimeState';
import type { OperationalTelemetryStatus } from '@/services/observability/operationalTelemetryTypes';
import { sanitizeSyncContractForOperationalSnapshot } from '@/services/storage/sync/syncQueueTaskFactory';
import {
  resolveSyncQueueBudgetState,
  resolveSyncQueueRuntimeState,
  SYNC_QUEUE_RUNTIME_THRESHOLDS,
} from '@/services/storage/sync/syncQueueOperationalBudgets';

export type SyncQueueSelectedTruth =
  | 'authority_intent_invariants'
  | 'remote_already_applied'
  | 'legacy_direct_publish'
  | 'blocked_before_publish';

export interface SyncQueueTruthSelectionTelemetryInput {
  resolution: NonNullable<SyncTask['syncContract']>['resolution'];
  selectedTruth: SyncQueueSelectedTruth;
  acceptedVersion?: string;
  acceptedRevision?: number;
}

export interface SyncQueueTelemetrySnapshot extends SyncQueueTelemetry {
  capturedAt: number;
}

export const buildSyncQueueTelemetryFromRows = (
  rows: SyncTask[],
  now: number,
  batchSize: number
): SyncQueueTelemetry => {
  const pendingRows = rows.filter(row => row.status === 'PENDING');
  const directQueueRows = pendingRows.filter(row => row.origin === 'direct_queue');
  const pendingBudgetState = resolveSyncQueueBudgetState(
    pendingRows.length,
    SYNC_QUEUE_RUNTIME_THRESHOLDS.warningPendingTasks,
    SYNC_QUEUE_RUNTIME_THRESHOLDS.criticalPendingTasks
  );
  const oldestTimestamp = pendingRows.reduce<number>(
    (acc, row) => (row.timestamp < acc ? row.timestamp : acc),
    Number.POSITIVE_INFINITY
  );
  const oldestPendingAgeMs =
    Number.isFinite(oldestTimestamp) && oldestTimestamp > 0
      ? Math.max(0, now - oldestTimestamp)
      : 0;
  const oldestDirectQueueTimestamp = directQueueRows.reduce<number>(
    (acc, row) => (row.timestamp < acc ? row.timestamp : acc),
    Number.POSITIVE_INFINITY
  );
  const oldestDirectQueueAgeMs =
    Number.isFinite(oldestDirectQueueTimestamp) && oldestDirectQueueTimestamp > 0
      ? Math.max(0, now - oldestDirectQueueTimestamp)
      : 0;
  const retrying = pendingRows.filter(row => row.retryCount > 0).length;
  const oldestPendingBudgetState = resolveSyncQueueBudgetState(
    oldestPendingAgeMs,
    SYNC_QUEUE_RUNTIME_THRESHOLDS.warningOldestPendingAgeMs,
    SYNC_QUEUE_RUNTIME_THRESHOLDS.criticalOldestPendingAgeMs
  );
  const retryingBudgetState = resolveSyncQueueBudgetState(
    retrying,
    SYNC_QUEUE_RUNTIME_THRESHOLDS.warningRetryingSyncTasks,
    SYNC_QUEUE_RUNTIME_THRESHOLDS.criticalRetryingSyncTasks
  );
  const directQueueBudgetState = resolveSyncQueueBudgetState(
    oldestDirectQueueAgeMs,
    SYNC_QUEUE_RUNTIME_THRESHOLDS.warningOldestPendingAgeMs,
    SYNC_QUEUE_RUNTIME_THRESHOLDS.criticalOldestPendingAgeMs
  );
  const runtimeState = resolveSyncQueueRuntimeState(
    pendingRows.length,
    oldestPendingAgeMs,
    retrying
  );

  return {
    pending: pendingRows.length,
    failed: rows.filter(row => row.status === 'FAILED').length,
    conflict: rows.filter(row => row.status === 'CONFLICT').length,
    retrying,
    oldestPendingAgeMs,
    oldestDirectQueueAgeMs,
    batchSize,
    pendingBudgetState,
    oldestPendingBudgetState,
    directQueueBudgetState,
    retryingBudgetState,
    runtimeState: directQueueBudgetState === 'critical' ? 'blocked' : runtimeState,
  };
};

export const buildSyncQueueTelemetrySnapshot = (
  rows: SyncTask[],
  now: number,
  batchSize: number
): SyncQueueTelemetrySnapshot => ({
  ...buildSyncQueueTelemetryFromRows(rows, now, batchSize),
  capturedAt: now,
});

export const recordSyncQueueFailureTelemetry = (
  task: Pick<SyncTask, 'id' | 'type' | 'key' | 'contexts'>,
  errorMessage: string,
  status: 'failed' | 'degraded',
  context?: Record<string, unknown>
): void => {
  const runtimeState = status === 'failed' ? 'blocked' : 'retryable';
  recordOperationalTelemetry({
    category: 'sync',
    status,
    runtimeState,
    operation: 'sync_queue_task_failure',
    issues: [errorMessage],
    context: {
      taskId: task.id,
      type: task.type,
      key: task.key,
      contexts: task.contexts,
      ...context,
    },
  });
};

export const recordSyncQueueConflictTelemetry = (
  task: Pick<SyncTask, 'id' | 'type' | 'key' | 'contexts'>,
  errorMessage: string
): void => {
  recordOperationalTelemetry({
    category: 'sync',
    status: 'degraded',
    runtimeState: 'blocked',
    operation: 'sync_queue_task_conflict',
    issues: [errorMessage],
    context: {
      taskId: task.id,
      type: task.type,
      key: task.key,
      contexts: task.contexts,
    },
  });
};

export const recordSyncQueueDecisionTelemetry = (
  task: Pick<SyncTask, 'id' | 'type' | 'key' | 'contexts'>,
  errorMessage: string,
  status: 'failed' | 'degraded' | 'conflict',
  context?: Record<string, unknown>
): void => {
  if (status === 'conflict') {
    recordSyncQueueConflictTelemetry(task, errorMessage);
    return;
  }

  recordSyncQueueFailureTelemetry(task, errorMessage, status, context);
};

export const recordSyncQueueStaleClaimTelemetry = (
  task: Pick<SyncTask, 'id' | 'type' | 'key' | 'contexts' | 'leaseOwner' | 'attemptId'>,
  action: 'update' | 'delete'
): void => {
  recordOperationalTelemetry({
    category: 'sync',
    operation: 'sync_queue_stale_claim_noop',
    status: 'degraded',
    runtimeState: 'recoverable',
    issues: ['Un worker de sincronizacion intento cerrar una tarea que ya no tenia reclamada.'],
    context: {
      action,
      taskId: task.id,
      type: task.type,
      key: task.key,
      contexts: task.contexts,
      leaseOwner: task.leaseOwner,
      attemptId: task.attemptId,
    },
  });
};

export const recordSyncQueueBudgetTelemetry = (
  telemetry: SyncQueueTelemetry,
  context: Record<string, unknown> = {}
): void => {
  if (telemetry.runtimeState === 'ok') {
    return;
  }

  recordOperationalTelemetry({
    category: 'sync',
    operation: 'sync_queue_budget_threshold',
    status: telemetry.runtimeState === 'blocked' ? 'failed' : 'degraded',
    runtimeState: telemetry.runtimeState === 'blocked' ? 'blocked' : 'degraded',
    issues: ['La cola de sincronizacion excedio sus budgets operativos.'],
    context: {
      pending: telemetry.pending,
      retrying: telemetry.retrying,
      failed: telemetry.failed,
      conflict: telemetry.conflict,
      pendingBudgetState: telemetry.pendingBudgetState,
      oldestPendingAgeMs: telemetry.oldestPendingAgeMs,
      oldestDirectQueueAgeMs: telemetry.oldestDirectQueueAgeMs,
      oldestPendingBudgetState: telemetry.oldestPendingBudgetState,
      directQueueBudgetState: telemetry.directQueueBudgetState,
      retryingBudgetState: telemetry.retryingBudgetState,
      ...context,
    },
  });
};

const resolveTruthTelemetryStatus = (
  resolution: SyncQueueTruthSelectionTelemetryInput['resolution']
): {
  status: OperationalTelemetryStatus;
  runtimeState: OperationalRuntimeState;
} => {
  if (resolution === 'blocked') {
    return { status: 'failed', runtimeState: 'blocked' };
  }
  if (resolution === 'stale') {
    return { status: 'degraded', runtimeState: 'retryable' };
  }
  return { status: 'success', runtimeState: 'recoverable' };
};

export const recordSyncQueueTruthSelectionTelemetry = (
  task: Pick<SyncTask, 'id' | 'type' | 'key' | 'contexts' | 'origin' | 'syncContract'>,
  input: SyncQueueTruthSelectionTelemetryInput
): void => {
  const telemetryStatus = resolveTruthTelemetryStatus(input.resolution);
  const contract = sanitizeSyncContractForOperationalSnapshot({
    ...task.syncContract,
    acceptedVersion: input.acceptedVersion ?? task.syncContract?.acceptedVersion,
    acceptedRevision: input.acceptedRevision ?? task.syncContract?.acceptedRevision,
    resolution: input.resolution,
  });

  recordOperationalTelemetry(
    {
      category: 'sync',
      operation: 'sync_queue_truth_selected',
      status: telemetryStatus.status,
      runtimeState: telemetryStatus.runtimeState,
      issues:
        input.resolution === 'blocked'
          ? ['La autoridad clinica bloqueo la mutacion antes de publicar.']
          : undefined,
      context: {
        taskId: task.id,
        type: task.type,
        key: task.key,
        contexts: task.contexts,
        origin: task.origin,
        selectedTruth: input.selectedTruth,
        resolution: input.resolution,
        expectedVersion: contract?.expectedVersion,
        acceptedVersion: contract?.acceptedVersion,
        acceptedRevision: contract?.acceptedRevision,
        recordRevision: contract?.recordRevision,
        baseRevision: contract?.baseRevision,
        mutationId: contract?.mutationId,
        mutationIds: contract?.mutationIds,
        clientId: contract?.clientId,
        tabId: contract?.tabId,
        changedPaths: contract?.changedPaths,
      },
    },
    { allowSuccess: true }
  );
};
