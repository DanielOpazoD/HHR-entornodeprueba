import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type { CreateSyncQueueEngineOptions, SyncQueueEnqueueResult } from './syncQueuePorts';
import { buildSyncQueueTaskContextMeta } from './syncQueueFailurePolicy';
import { buildSyncTaskContract, mergeSyncTaskContracts } from './syncTaskContractPolicy';
import { getSyncTaskKey, clearSyncTaskRuntimeState } from './syncQueueTaskFactory';
import {
  resolvePreOutboxHoldState,
  resolveSyncTaskNextAttemptAt,
  type SyncQueueEnqueueOptions,
} from './syncQueueEnqueuePolicy';
import { isAuthoringSessionCurrent } from '@/services/session/authoringSession';

/** Standalone immutable payload enqueue is loaded only when needed, outside clinical startup. */
const enqueueWithinTransaction = async (
  {
    store,
    runtime,
    maxPendingTasks,
  }: Pick<CreateSyncQueueEngineOptions, 'store' | 'runtime' | 'maxPendingTasks'> & {
    triggerProcessing: () => void;
  },
  type: SyncTask['type'],
  payload: unknown,
  meta: Pick<SyncTask, 'contexts' | 'origin' | 'recoveryPolicy' | 'syncContract'> | undefined,
  options: SyncQueueEnqueueOptions
): Promise<SyncQueueEnqueueResult> => {
  const key = getSyncTaskKey(type, payload);
  // The task belongs to whoever began the operation, never to whoever holds the browser now: once
  // that changed, nothing is enqueued in anyone's name (an interrupted run needs a new capture).
  const ownerKey = options.authoringSession.ownerKey;
  if (!isAuthoringSessionCurrent(options.authoringSession) || ownerKey !== runtime.getOwnerKey())
    return { accepted: false, mode: 'enqueue_failed', pendingTasks: 0, maxPendingTasks };
  const taskOwnerKey = ownerKey ?? undefined;
  const now = Date.now();
  const contextMeta = buildSyncQueueTaskContextMeta({
    contexts: meta?.contexts,
    recoveryPolicy: meta?.recoveryPolicy,
  });
  const syncContract = buildSyncTaskContract(type, payload, meta?.syncContract);

  if (key) {
    const existing = await store.findReusableTask(type, key, ownerKey, options.authoringSession);
    if (existing?.id) {
      const mergedSyncContract = mergeSyncTaskContracts(existing.syncContract, syncContract);
      await store.update(existing.id, {
        payload,
        timestamp: now,
        retryCount: 0,
        key,
        ownerKey: taskOwnerKey,
        contexts: contextMeta.contexts,
        origin: meta?.origin || existing.origin || 'direct_queue',
        recoveryPolicy: contextMeta.recoveryPolicy,
        syncContract: mergedSyncContract,
        ...clearSyncTaskRuntimeState(),
        nextAttemptAt: resolveSyncTaskNextAttemptAt(now, options),
        ...resolvePreOutboxHoldState(now, options),
      });
      const pendingTasks = await store.countActive(ownerKey);
      return {
        accepted: true,
        mode: 'reused',
        pendingTasks,
        maxPendingTasks,
      };
    }
  }

  const pendingTasks = await store.countActive(ownerKey);
  if (pendingTasks >= maxPendingTasks) {
    return {
      accepted: false,
      mode: 'rejected_backpressure',
      pendingTasks,
      maxPendingTasks,
    };
  }

  await store.add({
    opId: `${type}:${key ?? 'global'}:${now}`,
    type,
    payload,
    timestamp: now,
    retryCount: 0,
    key,
    ownerKey: taskOwnerKey,
    writerRole: options.authoringSession.writerRole,
    contexts: contextMeta.contexts,
    origin: meta?.origin || 'direct_queue',
    recoveryPolicy: contextMeta.recoveryPolicy,
    syncContract,
    ...clearSyncTaskRuntimeState(),
    nextAttemptAt: resolveSyncTaskNextAttemptAt(now, options),
    ...resolvePreOutboxHoldState(now, options),
  });
  return {
    accepted: true,
    mode: 'created',
    pendingTasks: pendingTasks + 1,
    maxPendingTasks,
  };
};

export const enqueueStandaloneSyncTask = async (
  ...args: Parameters<typeof enqueueWithinTransaction>
): Promise<SyncQueueEnqueueResult> => {
  const [{ store, triggerProcessing }, , , , options] = args;
  const operation = () => enqueueWithinTransaction(...args);
  const result = await (store.withEnqueueTransaction
    ? store.withEnqueueTransaction(operation)
    : operation());
  if (result.accepted && !options?.deferProcessing) triggerProcessing();
  return result;
};
