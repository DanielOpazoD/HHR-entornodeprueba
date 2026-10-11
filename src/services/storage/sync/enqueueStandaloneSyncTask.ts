import type { SyncTask } from '@/services/storage/syncQueueTypes';
import type {
  CreateSyncQueueEngineOptions,
  SyncQueueEnqueueResult,
} from './syncQueueEngineContracts';
import { buildSyncQueueTaskContextMeta } from './syncQueueFailurePolicy';
import { buildSyncTaskContract, mergeSyncTaskContracts } from './syncTaskContractPolicy';
import { getSyncTaskKey, clearSyncTaskRuntimeState } from './syncQueueTaskFactory';
import {
  countActiveSyncTasks,
  resolvePreOutboxHoldState,
  resolveSyncTaskNextAttemptAt,
  type SyncQueueEnqueueOptions,
} from './syncQueueEnqueuePolicy';

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
  meta?: Pick<SyncTask, 'contexts' | 'origin' | 'recoveryPolicy' | 'syncContract'>,
  options: SyncQueueEnqueueOptions = {}
): Promise<SyncQueueEnqueueResult> => {
  const countActiveTasks = async (ownerKey: string | null) =>
    countActiveSyncTasks(await store.listAll(ownerKey));
  const key = getSyncTaskKey(type, payload);
  const ownerKey = runtime.getOwnerKey();
  const taskOwnerKey = ownerKey ?? undefined;
  const now = Date.now();
  const contextMeta = buildSyncQueueTaskContextMeta({
    contexts: meta?.contexts,
    recoveryPolicy: meta?.recoveryPolicy,
  });
  const syncContract = buildSyncTaskContract(type, payload, meta?.syncContract);

  if (key) {
    const existing = await store.findReusableTask(type, key, ownerKey);
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
      const pendingTasks = await countActiveTasks(ownerKey);
      return {
        accepted: true,
        mode: 'reused',
        pendingTasks,
        maxPendingTasks,
      };
    }
  }

  const pendingTasks = await countActiveTasks(ownerKey);
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
