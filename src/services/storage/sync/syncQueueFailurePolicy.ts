import { buildSyncErrorSummary, classifySyncError } from '@/services/storage/syncErrorCatalog';
import type { SyncTask } from '@/services/storage/syncQueueTypes';
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
