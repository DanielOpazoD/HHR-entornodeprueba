import { ensureDbReady } from '@/services/storage/indexeddb/indexedDbCore';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import { createBrowserSyncRuntime } from '@/services/storage/sync/browserSyncRuntime';
import { createDexieSyncQueueStore } from '@/services/storage/sync/dexieSyncQueueStore';
import { createFirestoreSyncTransport } from '@/services/storage/sync/firestoreSyncTransport';
import { createDailyRecordSyncQueueActions } from '@/services/storage/sync/publicDailyRecordSyncQueueActions';
import { createQuarantinedSyncTaskActions } from '@/services/storage/sync/publicQuarantinedSyncTaskActions';
import { createSyncQueueEngine } from '@/services/storage/sync/syncQueueEngine';
import type { SyncQueueEnqueueResult } from '@/services/storage/sync/syncQueueEngineContracts';
import type { SyncQueueEnqueueOptions } from '@/services/storage/sync/syncQueueEnqueuePolicy';
import type { SyncQueueOperationSnapshot } from '@/services/storage/sync/syncQueueOperationSnapshot';
import type { SyncQueueDomainMetrics } from '@/services/storage/sync/syncDomainPolicy';
import type { SyncQueueTelemetry } from '@/services/storage/sync/syncQueueTelemetryContracts';
import { classifySyncError } from '@/services/storage/syncErrorCatalog';
import { createDomainObservability } from '@/services/observability/domainObservability';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import {
  BASE_RETRY_DELAY_MS,
  MAX_RETRIES,
  MAX_RETRY_DELAY_MS,
  SYNC_QUEUE_BATCH_SIZE,
  SYNC_QUEUE_MAX_PENDING_TASKS,
} from '@/services/storage/sync/syncQueueOperationalBudgets';
import { recordSyncQueueBudgetTelemetry } from '@/services/storage/sync/syncQueueTelemetryController';

const syncObservability = createDomainObservability('sync', 'SyncQueue');
const syncQueueStore = createDexieSyncQueueStore();
const syncRuntime = createBrowserSyncRuntime();

const getSyncOwnerKey = (): string | null => syncRuntime.getOwnerKey();

const toSyncIssueMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;

const recordSyncRuntimeReadFailure = (
  operation: string,
  error: unknown,
  context: Record<string, unknown> = {}
): void => {
  recordOperationalTelemetry({
    category: 'sync',
    operation,
    status: 'failed',
    runtimeState: 'blocked',
    issues: [toSyncIssueMessage(error, 'La cola de sincronizacion no pudo leerse.')],
    context,
  });
};

const buildUnavailableSyncQueueTelemetry = (error: unknown): SyncQueueTelemetry => ({
  pending: 0,
  failed: 0,
  conflict: 0,
  retrying: 0,
  orphanedTasks: 0,
  oldestPendingAgeMs: 0,
  oldestDirectQueueAgeMs: 0,
  batchSize: SYNC_QUEUE_BATCH_SIZE,
  pendingBudgetState: 'ok',
  oldestPendingBudgetState: 'ok',
  directQueueBudgetState: 'ok',
  retryingBudgetState: 'ok',
  runtimeState: 'blocked',
  readState: 'unavailable',
  ownerKey: getSyncOwnerKey(),
  issues: [toSyncIssueMessage(error, 'La cola de sincronizacion no pudo leerse.')],
});

const syncQueueEngine = createSyncQueueEngine({
  store: syncQueueStore,
  runtime: syncRuntime,
  transport: createFirestoreSyncTransport(),
  batchSize: SYNC_QUEUE_BATCH_SIZE,
  maxPendingTasks: SYNC_QUEUE_MAX_PENDING_TASKS,
  maxRetries: MAX_RETRIES,
  baseRetryDelayMs: BASE_RETRY_DELAY_MS,
  maxRetryDelayMs: MAX_RETRY_DELAY_MS,
});

export const {
  ackDailyRecordSyncTask,
  getPendingDailyRecordSyncTaskSnapshot,
  replacePendingDailyRecordSyncTaskWithLocalRecord,
  adoptAuthoritativeDailyRecordAtomically,
  releaseDailyRecordPreOutboxHold,
  renewDailyRecordPreOutboxHold,
} = createDailyRecordSyncQueueActions({
  ensureReady: ensureDbReady,
  store: syncQueueStore,
  getOwnerKey: getSyncOwnerKey,
  logger: syncObservability.logger,
  replacePendingTask: syncQueueEngine.replacePendingDailyRecordTaskWithLocalRecord,
  triggerProcessing: syncQueueEngine.triggerProcessing,
});

export const recordSyncQueueOwnershipTelemetry = (
  operation: 'session_owner_changed' | 'session_owner_cleared',
  context: Record<string, unknown> = {}
): void => {
  recordOperationalTelemetry({
    category: 'sync',
    operation,
    status: 'degraded',
    runtimeState: 'recoverable',
    issues: [
      'La cola de sincronizacion actualizo su ownership local para mantener aislamiento entre sesiones.',
    ],
    context: {
      ownerKey: getSyncOwnerKey(),
      ...context,
    },
  });
};

export const isConflictSyncError = (error: unknown): boolean =>
  classifySyncError(error).category === 'conflict';

export const isRetryableSyncError = (error: unknown): boolean => classifySyncError(error).retryable;

export const getSyncQueueStats = async (): Promise<{
  pending: number;
  failed: number;
  conflict: number;
}> => {
  try {
    await ensureDbReady();
    return await syncQueueEngine.getStats();
  } catch (error) {
    syncObservability.logger.warn('Failed to read queue stats', error);
    recordSyncRuntimeReadFailure('sync_queue_stats_unavailable', error, {
      source: 'public_sync_queue',
    });
    return { pending: 0, failed: 0, conflict: 0 };
  }
};

export const getSyncQueueTelemetry = async (): Promise<SyncQueueTelemetry> => {
  try {
    await ensureDbReady();
    const telemetry = await syncQueueEngine.getTelemetry();
    const ownerKey = getSyncOwnerKey();
    const orphanedTasks = await syncQueueStore.countForeign(ownerKey);
    recordSyncQueueBudgetTelemetry(telemetry, {
      source: 'public_sync_queue',
      batchSize: SYNC_QUEUE_BATCH_SIZE,
      maxRetries: MAX_RETRIES,
      ownerKey,
      orphanedTasks,
    });
    return {
      ...telemetry,
      ownerKey,
      orphanedTasks,
      readState: 'ok',
    };
  } catch (error) {
    syncObservability.logger.warn('Failed to read queue telemetry', error);
    recordSyncRuntimeReadFailure('sync_queue_telemetry_unavailable', error, {
      source: 'public_sync_queue',
      batchSize: SYNC_QUEUE_BATCH_SIZE,
      maxRetries: MAX_RETRIES,
    });
    return buildUnavailableSyncQueueTelemetry(error);
  }
};

export const listRecentSyncQueueOperations = async (
  limit: number
): Promise<SyncQueueOperationSnapshot[]> => {
  try {
    await ensureDbReady();
    return await syncQueueEngine.listRecentOperations(limit);
  } catch (error) {
    syncObservability.logger.warn('Failed to list recent operations', error);
    recordSyncRuntimeReadFailure('sync_queue_recent_operations_unavailable', error, {
      source: 'public_sync_queue',
      limit,
    });
    return [];
  }
};

export const getSyncQueueDomainMetrics = async (): Promise<SyncQueueDomainMetrics> => {
  try {
    await ensureDbReady();
    return await syncQueueEngine.getDomainMetrics();
  } catch (error) {
    syncObservability.logger.warn('Failed to read domain metrics', error);
    recordSyncRuntimeReadFailure('sync_queue_domain_metrics_unavailable', error, {
      source: 'public_sync_queue',
    });
    return {
      byContext: {
        clinical: { pending: 0, failed: 0, conflict: 0, retrying: 0 },
        staffing: { pending: 0, failed: 0, conflict: 0, retrying: 0 },
        movements: { pending: 0, failed: 0, conflict: 0, retrying: 0 },
        handoff: { pending: 0, failed: 0, conflict: 0, retrying: 0 },
        metadata: { pending: 0, failed: 0, conflict: 0, retrying: 0 },
        unknown: { pending: 0, failed: 0, conflict: 0, retrying: 0 },
      },
      byOrigin: {},
      byRecoveryPolicy: {},
    };
  }
};

export const queueSyncTask = async (
  type: SyncTask['type'],
  payload: unknown,
  meta?: Pick<SyncTask, 'contexts' | 'origin' | 'recoveryPolicy' | 'syncContract'>,
  options?: SyncQueueEnqueueOptions
): Promise<SyncQueueEnqueueResult> => {
  try {
    await ensureDbReady();
    const result = await syncQueueEngine.queueTask(type, payload, meta, options);
    if (!result.accepted && result.mode === 'rejected_backpressure') {
      recordOperationalTelemetry({
        category: 'sync',
        operation: 'sync_queue_backpressure_rejected',
        status: 'failed',
        runtimeState: 'blocked',
        issues: [
          'La cola de sincronizacion alcanzo su limite operativo y no acepto una nueva tarea.',
        ],
        context: {
          type,
          contexts: meta?.contexts,
          origin: meta?.origin,
          recoveryPolicy: meta?.recoveryPolicy,
          pendingTasks: result.pendingTasks,
          maxPendingTasks: result.maxPendingTasks,
        },
      });
    }
    return result;
  } catch (error) {
    syncObservability.logger.error('Failed to queue task', error);
    recordOperationalTelemetry({
      category: 'sync',
      operation: 'sync_queue_enqueue_failure',
      status: 'failed',
      runtimeState: 'blocked',
      issues: [toSyncIssueMessage(error, 'La cola de sincronizacion no pudo recibir la tarea.')],
      context: {
        type,
        contexts: meta?.contexts,
        origin: meta?.origin,
        recoveryPolicy: meta?.recoveryPolicy,
      },
    });
    return {
      accepted: false,
      mode: 'enqueue_failed',
      pendingTasks: 0,
      maxPendingTasks: SYNC_QUEUE_MAX_PENDING_TASKS,
    };
  }
};

export const queueDailyRecordSyncTaskWithLocalRecord = async (
  record: DailyRecord,
  meta?: Pick<SyncTask, 'contexts' | 'origin' | 'recoveryPolicy' | 'syncContract'>,
  options?: SyncQueueEnqueueOptions
): Promise<SyncQueueEnqueueResult> => {
  try {
    await ensureDbReady();
    const result = await syncQueueEngine.queueDailyRecordTaskWithLocalRecord(record, meta, options);
    if (!result.accepted && result.mode === 'rejected_backpressure') {
      recordOperationalTelemetry({
        category: 'sync',
        operation: 'sync_queue_backpressure_rejected',
        status: 'failed',
        runtimeState: 'blocked',
        issues: [
          'La cola de sincronizacion alcanzo su limite operativo y no acepto una nueva tarea.',
        ],
        context: {
          type: 'UPDATE_DAILY_RECORD',
          contexts: meta?.contexts,
          origin: meta?.origin,
          recoveryPolicy: meta?.recoveryPolicy,
          pendingTasks: result.pendingTasks,
          maxPendingTasks: result.maxPendingTasks,
        },
      });
    }
    return result;
  } catch (error) {
    syncObservability.logger.error('Failed to queue task with local record', error);
    recordOperationalTelemetry({
      category: 'sync',
      operation: 'sync_queue_transactional_enqueue_failure',
      status: 'failed',
      runtimeState: 'blocked',
      issues: [
        toSyncIssueMessage(
          error,
          'La cola de sincronizacion no pudo guardar el registro y la tarea.'
        ),
      ],
      context: {
        type: 'UPDATE_DAILY_RECORD',
        date: record.date,
        contexts: meta?.contexts,
        origin: meta?.origin,
        recoveryPolicy: meta?.recoveryPolicy,
      },
    });
    return {
      accepted: false,
      mode: 'enqueue_failed',
      pendingTasks: 0,
      maxPendingTasks: SYNC_QUEUE_MAX_PENDING_TASKS,
    };
  }
};

export const { retryQuarantinedSyncTask, discardQuarantinedSyncTask } =
  createQuarantinedSyncTaskActions({
    ensureReady: ensureDbReady,
    store: syncQueueStore,
    getOwnerKey: getSyncOwnerKey,
    logger: syncObservability.logger,
    recordReadFailure: recordSyncRuntimeReadFailure,
    triggerProcessing: syncQueueEngine.triggerProcessing,
  });

export const processSyncQueue = async (): Promise<void> => {
  try {
    await ensureDbReady();
    await syncQueueEngine.processQueue();
  } catch (error) {
    syncObservability.logger.error('Failed to process queue', error);
    recordOperationalTelemetry({
      category: 'sync',
      operation: 'sync_queue_process_failure',
      status: 'failed',
      runtimeState: 'blocked',
      issues: [toSyncIssueMessage(error, 'La cola de sincronizacion no pudo procesarse.')],
      context: {
        source: 'public_sync_queue',
      },
    });
  }
};

export const clearSyncQueueForOwner = async (ownerKey: string | null): Promise<void> => {
  try {
    await ensureDbReady();
    await syncQueueStore.deleteByOwner(ownerKey);
  } catch (error) {
    syncObservability.logger.error('Failed to clear sync queue for owner', error);
    recordOperationalTelemetry({
      category: 'sync',
      operation: 'sync_queue_owner_clear_failure',
      status: 'failed',
      runtimeState: 'blocked',
      issues: [
        toSyncIssueMessage(error, 'La cola de sincronizacion no pudo limpiarse para esta sesion.'),
      ],
      context: {
        ownerKey,
      },
    });
  }
};

export const clearAllSyncQueue = async (): Promise<void> => {
  try {
    await ensureDbReady();
    await syncQueueStore.deleteAll();
  } catch (error) {
    syncObservability.logger.error('Failed to clear full sync queue', error);
    recordOperationalTelemetry({
      category: 'sync',
      operation: 'sync_queue_clear_all_failure',
      status: 'failed',
      runtimeState: 'blocked',
      issues: [
        toSyncIssueMessage(error, 'La cola de sincronizacion no pudo limpiarse por completo.'),
      ],
    });
  }
};

export const ensureSyncQueueOnlineListener = (): void => {
  syncQueueEngine.ensureOnlineListener();
};

ensureSyncQueueOnlineListener();

export type {
  SyncQueueDomainMetrics,
  SyncQueueEnqueueResult,
  SyncQueueOperationSnapshot,
  SyncQueueTelemetry,
};
