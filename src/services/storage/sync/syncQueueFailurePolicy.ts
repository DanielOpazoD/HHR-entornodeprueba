import { isFunctionsReloadRequired } from '@/services/firebase-runtime/functionsModuleLoader';
import { buildSyncErrorSummary, classifySyncError } from '@/services/storage/syncErrorCatalog';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
import { buildSyncMutationIdentity } from '@/services/storage/sync/syncMutationIdentity';
import {
  normalizeSyncTaskContexts,
  resolveSyncDomainRetryProfile,
} from '@/services/storage/sync/syncDomainPolicy';

export interface SyncQueueFailureDecision {
  status: SyncTask['status'];
  retryCount: number;
  nextAttemptAt?: number;
  contexts: SyncTask['contexts'];
  recoveryPolicy: SyncTask['recoveryPolicy'];
  error: string;
  lastErrorCode?: string;
  lastErrorCategory?: string;
  lastErrorSeverity?: string;
  lastErrorAction?: string;
  lastErrorAt: number;
  shouldLogPermanentFailure: boolean;
}

export interface SyncQueueFailurePolicyOptions {
  task: SyncTask;
  error: unknown;
  maxRetries: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
  now?: number;
}

export const buildSyncQueueTaskContextMeta = (
  task: Pick<SyncTask, 'contexts' | 'recoveryPolicy'>
) => {
  const contexts = normalizeSyncTaskContexts(task.contexts);
  const domainProfile = resolveSyncDomainRetryProfile(contexts);
  return {
    contexts,
    recoveryPolicy: task.recoveryPolicy || domainProfile.id,
    domainProfile,
  };
};

export const buildSyncQueueTaskErrorMeta = (error: unknown, now: number = Date.now()) => {
  const classification = classifySyncError(error);
  return {
    classification,
    errorMeta: {
      error: buildSyncErrorSummary(classification),
      lastErrorCode: classification.code,
      lastErrorCategory: classification.category,
      lastErrorSeverity: classification.severity,
      lastErrorAction: classification.recommendedAction,
      lastErrorAt: now,
    },
  };
};

const computeBackoffMs = (
  attempt: number,
  baseRetryDelayMs: number,
  maxRetryDelayMs: number
): number => {
  const jitter = Math.random() * 500;
  const delay = Math.min(baseRetryDelayMs * Math.pow(2, attempt - 1), maxRetryDelayMs);
  return delay + jitter;
};

/**
 * The queued write left as a conflict holding only the `detachedPaths` a replay could not apply.
 * The nurse retries or discards it; a later edit of the same day picks it up again.
 */
export const buildDetachedEditsConflict = (task: SyncTask, detachedPaths: string[]) => ({
  status: 'CONFLICT' as const,
  syncContract: {
    ...task.syncContract,
    changedPaths: detachedPaths,
    // The stored day never applied them: a replay must not pass for one that did.
    mutationId: buildSyncMutationIdentity().mutationId,
    mutationIds: undefined,
  },
  error: `Edición de ${[...new Set(detachedPaths.map(path => path.split('.')[1]))].join(', ')} sin escribir: la identidad cambió en otra sesión.`,
  lastErrorCode: 'identity_review_edit_detached',
  lastErrorCategory: 'conflict' as const,
  lastErrorAt: Date.now(),
  leaseOwner: undefined,
  leaseUntil: undefined,
  attemptId: undefined,
  processingStartedAt: undefined,
});

export const resolveSyncQueueFailureDecision = ({
  task,
  error,
  maxRetries,
  baseRetryDelayMs,
  maxRetryDelayMs,
  now = Date.now(),
}: SyncQueueFailurePolicyOptions): SyncQueueFailureDecision => {
  const { classification, errorMeta } = buildSyncQueueTaskErrorMeta(error, now);
  const { contexts, recoveryPolicy, domainProfile } = buildSyncQueueTaskContextMeta(task);

  if (isFunctionsReloadRequired() && classification.category === 'network') {
    return {
      ...errorMeta,
      lastErrorAction: 'reload_functions',
      contexts,
      recoveryPolicy,
      status: 'PENDING',
      retryCount: task.retryCount,
      nextAttemptAt: now + Math.max(60_000, maxRetryDelayMs),
      shouldLogPermanentFailure: false,
    };
  }

  if (classification.category === 'conflict') {
    return {
      status: 'CONFLICT',
      retryCount: task.retryCount,
      contexts,
      recoveryPolicy,
      shouldLogPermanentFailure: false,
      ...errorMeta,
      lastErrorAction: domainProfile.conflictAction,
    };
  }

  if (!classification.retryable) {
    return {
      status: 'FAILED',
      retryCount: task.retryCount,
      contexts,
      recoveryPolicy,
      // Un no-retryable ES un fallo permanente desde el primer intento: sin
      // este log, la píldora venenosa entraba a cuarentena en silencio.
      shouldLogPermanentFailure: true,
      ...errorMeta,
    };
  }

  const newRetryCount = task.retryCount + 1;
  const retryBudget = Math.min(maxRetries, domainProfile.retryBudget);
  if (newRetryCount >= retryBudget) {
    return {
      status: 'FAILED',
      retryCount: newRetryCount,
      contexts,
      recoveryPolicy,
      shouldLogPermanentFailure: true,
      ...errorMeta,
    };
  }

  return {
    status: 'PENDING',
    retryCount: newRetryCount,
    nextAttemptAt:
      now +
      computeBackoffMs(newRetryCount, baseRetryDelayMs, maxRetryDelayMs) *
        Math.max(1, domainProfile.delayMultiplier),
    contexts,
    recoveryPolicy,
    shouldLogPermanentFailure: false,
    ...errorMeta,
  };
};
