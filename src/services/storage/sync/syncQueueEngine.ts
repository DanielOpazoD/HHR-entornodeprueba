import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import type { ErrorSeverity } from '@/services/logging/errorLogTypes';
import { logError } from '@/services/utils/errorService';
import type { SpecialistHandoffSyncPayload, SyncTask } from '@/services/storage/syncQueueTypes';
import type { SyncTransportResult } from '@/services/storage/sync/syncQueuePorts';
import type { SyncErrorCategory } from '@/services/storage/syncErrorCatalog';
import type {
  CreateSyncQueueEngineOptions,
  SyncQueueEnqueueResult,
} from '@/services/storage/sync/syncQueueEngineContracts';
import { measureRepositoryOperation } from '@/services/repositories/repositoryPerformance';
import {
  buildSyncQueueDomainMetrics,
  type SyncQueueDomainMetrics,
} from '@/services/storage/sync/syncDomainPolicy';
import type { SyncQueueTelemetry } from '@/services/storage/sync/syncQueueTelemetryContracts';
import {
  resolveSyncQueueFailureDecision,
  buildSyncQueueTaskContextMeta,
  buildDetachedEditsConflict,
} from '@/services/storage/sync/syncQueueFailurePolicy';
import {
  buildSyncQueueTelemetryFromRows,
  recordSyncQueueDecisionTelemetry,
  recordSyncQueueStaleClaimTelemetry,
} from '@/services/storage/sync/syncQueueTelemetryController';
import { buildSyncTaskContract } from '@/services/storage/sync/syncTaskContractPolicy';
import {
  clearSyncTaskRuntimeState,
  buildTaskClaim,
  createSyncQueueAttemptId,
  createSyncQueueWorkerId,
  getSyncTaskKey,
} from '@/services/storage/sync/syncQueueTaskFactory';
import {
  toSyncQueueOperationSnapshot,
  type SyncQueueOperationSnapshot,
} from '@/services/storage/sync/syncQueueOperationSnapshot';
import {
  countActiveSyncTasks,
  resolvePreOutboxHoldState,
  resolveSyncTaskNextAttemptAt,
  type SyncQueueEnqueueOptions,
} from '@/services/storage/sync/syncQueueEnqueuePolicy';
import { replacePendingDailyRecordTask } from '@/services/storage/sync/syncQueuePendingDailyRecordReplacement';
import type { PendingDailyRecordSyncTaskIdentity } from '@/services/storage/sync/pendingDailyRecordSyncTask';

const SYNC_QUEUE_LEASE_MS = 30_000;

export const createSyncQueueEngine = ({
  store,
  runtime,
  transport,
  batchSize,
  maxPendingTasks,
  maxRetries,
  baseRetryDelayMs,
  maxRetryDelayMs,
}: CreateSyncQueueEngineOptions) => {
  let isProcessing = false;
  const workerId = createSyncQueueWorkerId();

  const triggerProcessing = (): void => {
    if (!runtime.isOnline()) return;
    void processQueue();
  };

  const countActiveTasks = async (ownerKey: string | null): Promise<number> =>
    countActiveSyncTasks(await store.listAll(ownerKey));

  const updateClaimedTaskState = async (
    task: SyncTask,
    patch: Partial<SyncTask> & { status: SyncTask['status'] }
  ): Promise<void> => {
    if (!task.id) return;
    const claim = buildTaskClaim(task);
    if (!claim) return;
    const updated = await store.updateClaimed(task.id, patch, claim);
    if (!updated) {
      recordSyncQueueStaleClaimTelemetry(task, 'update');
    }
  };

  const handleTaskFailure = async (task: SyncTask, error: unknown): Promise<void> => {
    if (!task.id) {
      return;
    }

    const decision = resolveSyncQueueFailureDecision({
      task,
      error,
      maxRetries,
      baseRetryDelayMs,
      maxRetryDelayMs,
    });

    await updateClaimedTaskState(task, {
      status: decision.status,
      retryCount: decision.retryCount,
      nextAttemptAt: decision.nextAttemptAt,
      contexts: decision.contexts,
      recoveryPolicy: decision.recoveryPolicy,
      error: decision.error,
      lastErrorCode: decision.lastErrorCode,
      lastErrorCategory: decision.lastErrorCategory as SyncErrorCategory | undefined,
      lastErrorSeverity: decision.lastErrorSeverity as ErrorSeverity | undefined,
      lastErrorAction: decision.lastErrorAction,
      lastErrorAt: decision.lastErrorAt,
      leaseOwner: undefined,
      leaseUntil: undefined,
      attemptId: undefined,
      processingStartedAt: undefined,
    });

    if (decision.shouldLogPermanentFailure) {
      logError('Sync task permanently failed', error instanceof Error ? error : undefined, {
        taskId: task.id,
        type: task.type,
        key: task.key,
        retryCount: decision.retryCount,
        contexts: decision.contexts,
        recoveryPolicy: decision.recoveryPolicy,
      });
    }

    recordSyncQueueDecisionTelemetry(
      task,
      decision.error,
      decision.status === 'CONFLICT'
        ? 'conflict'
        : decision.status === 'FAILED'
          ? 'failed'
          : 'degraded',
      decision.status === 'CONFLICT' ? undefined : { retryCount: decision.retryCount }
    );
  };

  const queueTask = async (
    type: SyncTask['type'],
    payload: unknown,
    meta?: Pick<SyncTask, 'contexts' | 'origin' | 'recoveryPolicy' | 'syncContract'>,
    options: SyncQueueEnqueueOptions = {}
  ): Promise<SyncQueueEnqueueResult> => {
    const { enqueueStandaloneSyncTask } = await import('./enqueueStandaloneSyncTask');
    return enqueueStandaloneSyncTask(
      { store, runtime, maxPendingTasks, triggerProcessing },
      type,
      payload,
      meta,
      options
    );
  };

  const queueDailyRecordTaskWithLocalRecord = async (
    record: DailyRecord,
    meta?: Pick<SyncTask, 'contexts' | 'origin' | 'recoveryPolicy' | 'syncContract'>,
    options: SyncQueueEnqueueOptions = {},
    /** A specialist note is its own task: never coalesced into the day record task. */
    handoff?: SpecialistHandoffSyncPayload
  ): Promise<SyncQueueEnqueueResult> => {
    const type: SyncTask['type'] = handoff ? 'UPDATE_SPECIALIST_HANDOFF' : 'UPDATE_DAILY_RECORD';
    const payload = handoff ?? record;
    const key = getSyncTaskKey(type, payload);
    const ownerKey = runtime.getOwnerKey();
    const taskOwnerKey = ownerKey ?? undefined;
    const now = Date.now();
    const contextMeta = buildSyncQueueTaskContextMeta({
      contexts: meta?.contexts,
      recoveryPolicy: meta?.recoveryPolicy,
    });
    const existing = key ? await store.findReusableTask(type, key, ownerKey) : null;
    // The store merges this write's own intent with the pending task inside its transaction.
    const syncContract = buildSyncTaskContract(type, payload, meta?.syncContract);

    const pendingTasks = await countActiveTasks(ownerKey);
    if (!existing && pendingTasks >= maxPendingTasks) {
      return {
        accepted: false,
        mode: 'rejected_backpressure',
        pendingTasks,
        maxPendingTasks,
      };
    }

    const mode = await store.saveDailyRecordWithTask(
      record,
      {
        opId: `${type}:${key ?? 'global'}:${now}`,
        type,
        payload,
        timestamp: now,
        retryCount: 0,
        key,
        ownerKey: taskOwnerKey,
        contexts: contextMeta.contexts,
        origin: meta?.origin || existing?.origin || 'direct_queue',
        recoveryPolicy: contextMeta.recoveryPolicy,
        syncContract,
        ...clearSyncTaskRuntimeState(),
        nextAttemptAt: resolveSyncTaskNextAttemptAt(now, options),
        ...resolvePreOutboxHoldState(now, options),
      },
      options.patchWrite
    );

    if (!options.deferProcessing) {
      triggerProcessing();
    }
    return {
      accepted: true,
      mode,
      pendingTasks: mode === 'created' ? pendingTasks + 1 : pendingTasks,
      maxPendingTasks,
    };
  };
  const replacePendingDailyRecordTaskWithLocalRecord = async (
    record: DailyRecord,
    meta?: Pick<SyncTask, 'contexts' | 'origin' | 'recoveryPolicy' | 'syncContract'>,
    expectedTask?: PendingDailyRecordSyncTaskIdentity
  ): Promise<boolean> =>
    replacePendingDailyRecordTask({
      record,
      meta,
      store,
      runtime,
      triggerProcessing,
      expectedTask,
    });
  const getTelemetry = async (): Promise<SyncQueueTelemetry> => {
    const ownerKey = runtime.getOwnerKey();
    const rows = await store.listAll(ownerKey);
    return buildSyncQueueTelemetryFromRows(rows, Date.now(), batchSize);
  };

  const getStats = async (): Promise<{ pending: number; failed: number; conflict: number }> => {
    const telemetry = await getTelemetry();
    return {
      pending: telemetry.pending,
      failed: telemetry.failed,
      conflict: telemetry.conflict,
    };
  };

  const listRecentOperations = async (limit: number): Promise<SyncQueueOperationSnapshot[]> => {
    const rows = await store.listRecent(limit, runtime.getOwnerKey());
    return rows.map(toSyncQueueOperationSnapshot);
  };

  const getDomainMetrics = async (): Promise<SyncQueueDomainMetrics> => {
    const rows = await store.listAll(runtime.getOwnerKey());
    return buildSyncQueueDomainMetrics(rows);
  };

  const processQueue = async (): Promise<void> => {
    if (isProcessing) return;
    isProcessing = true;

    try {
      await measureRepositoryOperation(
        'syncQueue.process',
        async () => {
          while (true) {
            const now = Date.now();
            const readyTasks = await store.claimReadyPending(
              now,
              batchSize,
              runtime.getOwnerKey(),
              {
                leaseOwner: workerId,
                leaseUntil: now + SYNC_QUEUE_LEASE_MS,
                attemptId: createSyncQueueAttemptId(),
              }
            );
            if (readyTasks.length === 0) {
              return;
            }

            for (const task of readyTasks) {
              if (!task.id) continue;

              try {
                const dispatchClaim = buildTaskClaim(task);
                if (!dispatchClaim) continue;
                const leaseUntil = Date.now() + SYNC_QUEUE_LEASE_MS;
                // A slow preceding task can outlive the batch lease. Fence and renew
                // atomically before dispatch, so another worker's task is never replayed.
                if (!(await store.updateClaimed(task.id, { leaseUntil }, dispatchClaim))) {
                  recordSyncQueueStaleClaimTelemetry(task, 'update');
                  continue;
                }
                task.leaseUntil = leaseUntil;
                const result: Partial<SyncTransportResult> = (await transport.run(task)) || {};
                const claim = buildTaskClaim(task);
                if (claim && result.detachedPaths?.length) {
                  // What the write left out is never acknowledged: the claimed task becomes, in
                  // one claimed update, a conflict holding only it, on the day it was written on.
                  await updateClaimedTaskState(
                    task,
                    buildDetachedEditsConflict(task, result.detachedPaths)
                  );
                } else if (claim) {
                  const deleted = await store.deleteClaimed(
                    task.id,
                    claim,
                    result.authoritativeRecord,
                    result.detachedConflicts
                  );
                  if (!deleted) {
                    recordSyncQueueStaleClaimTelemetry(task, 'delete');
                  }
                }
              } catch (error) {
                await handleTaskFailure(task, error);
              }
            }

            if (readyTasks.length < batchSize) {
              return;
            }
          }
        },
        { thresholdMs: 250, context: `batch=${batchSize}` }
      );
    } finally {
      isProcessing = false;
    }
  };
  const ensureOnlineListener = (): void => {
    runtime.onOnline(() => {
      triggerProcessing();
    });
  };
  return {
    queueTask,
    queueDailyRecordTaskWithLocalRecord,
    replacePendingDailyRecordTaskWithLocalRecord,
    processQueue,
    getTelemetry,
    getDomainMetrics,
    getStats,
    listRecentOperations,
    ensureOnlineListener,
    triggerProcessing,
  };
};
