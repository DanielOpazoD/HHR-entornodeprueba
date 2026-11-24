import { isFunctionsReloadRequired } from '@/services/firebase-runtime/functionsModuleLoader';
import { getValueAtPath } from '@/services/repositories/conflictResolutionUtils';
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

/** How a write refused as a conflict is held: by its replay, or at once when it already met it. */
export const resolveHeldConflictState = (
  error: unknown,
  contexts: SyncTask['contexts'],
  now: number = Date.now()
) => {
  const { classification, errorMeta } = buildSyncQueueTaskErrorMeta(error, now);
  if (classification.category !== 'conflict') return undefined;
  return {
    status: 'CONFLICT' as const,
    ...errorMeta,
    lastErrorAction: resolveSyncDomainRetryProfile(normalizeSyncTaskContexts(contexts))
      .conflictAction,
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

  const heldConflict = resolveHeldConflictState(error, contexts, now);
  if (heldConflict) {
    return {
      ...heldConflict,
      retryCount: task.retryCount,
      contexts,
      recoveryPolicy,
      shouldLogPermanentFailure: false,
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

const nonEmptyFailureText = (value: unknown): string =>
  typeof value === 'string' && value.trim() ? value.trim() : 'desconocido';

/** Local diagnosis only. Never look up a bed: it may now belong to another episode. */
export const buildSyncQueueFailureContext = (task: SyncTask) => {
  const common = {
    clinicalDate: task.key || 'desconocido',
    action: task.type,
    fieldLabel: task.syncContract?.changedPaths?.join(', ') || 'desconocido',
  };
  const context = (slot: string, source: unknown) => ({
    ...common,
    bedLabel: slot,
    patientName: nonEmptyFailureText(getValueAtPath(source, 'patientName')),
    clinicalEpisodeId: nonEmptyFailureText(getValueAtPath(source, 'clinicalEpisodeId')),
  });
  if (task.type === 'UPDATE_PATIENT') {
    return { localSyncFailure: [context('desconocido', task.payload)] };
  }
  if (task.type === 'UPDATE_DAILY_RECORD') {
    const slots = [
      ...new Set(
        (task.syncContract?.changedPaths || []).flatMap(path => {
          const match = /^(beds\.[^.]+(?:\.clinicalCrib)?)(?:\.|$)/.exec(path);
          return match?.[1] ? [match[1]] : [];
        })
      ),
    ];
    if (slots.length) {
      return {
        localSyncFailure: slots.map(slot => {
          // Presence of original context forbids borrowing identity from a newer projection.
          const source = task.patchBaseContext
            ? Object.fromEntries(
                ['patientName', 'clinicalEpisodeId'].map(field => [
                  field,
                  task.patchBaseContext?.[`${slot}.${field}`],
                ])
              )
            : getValueAtPath(task.payload, slot);
          return context(slot, source);
        }),
      };
    }
    // A day-level write has no single patient. Keep captured keys without choosing an occupant.
    if (task.syncContract?.clinicalEpisodeKeys?.length) {
      return {
        localSyncFailure: task.syncContract.clinicalEpisodeKeys.map(clinicalEpisodeId => ({
          ...context('desconocido', undefined),
          clinicalEpisodeId,
        })),
      };
    }
  }
  return { localSyncFailure: [context('desconocido', undefined)] };
};
