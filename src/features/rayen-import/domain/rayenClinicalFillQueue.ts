import {
  classifyRayenSyncError,
  reportRayenSyncWarning,
} from '../observability/rayenSyncDiagnostics';

export type RayenClinicalFillQueueOutcome = 'completed' | 'drained' | 'superseded';

export interface RayenClinicalFillQueueContext {
  startedAfterQueue: boolean;
}

interface QueueEntry {
  key: string;
  task: (context: RayenClinicalFillQueueContext) => Promise<void>;
  startedAfterQueue: boolean;
  promise: Promise<RayenClinicalFillQueueOutcome>;
  resolve: (outcome: RayenClinicalFillQueueOutcome) => void;
}

let active: QueueEntry | null = null;
let pending: QueueEntry | null = null;

const createEntry = (
  key: string,
  task: QueueEntry['task'],
  startedAfterQueue: boolean
): QueueEntry => {
  let resolve!: QueueEntry['resolve'];
  const promise = new Promise<RayenClinicalFillQueueOutcome>(settle => {
    resolve = settle;
  });
  return { key, task, startedAfterQueue, promise, resolve };
};

const start = (entry: QueueEntry): void => {
  active = entry;
  let taskPromise: Promise<void>;
  try {
    taskPromise = entry.task({ startedAfterQueue: entry.startedAfterQueue });
  } catch (error) {
    taskPromise = Promise.reject(error);
  }
  void taskPromise
    // The task owns expected clinical/audit failures. This guard records unexpected escapes while
    // preserving queue liveness and never includes the raw provider error.
    .catch(error => {
      reportRayenSyncWarning('clinical_fill_queue_task_failed', {
        errorKind: classifyRayenSyncError(error),
      });
    })
    .finally(() => {
      active = null;
      const next = pending;
      pending = null;
      if (next) {
        entry.resolve('completed');
        start(next);
      } else {
        entry.resolve('drained');
      }
    });
};

/**
 * Single active clinical fill plus one latest pending fill. Repeated requests for the same applied
 * run share one promise; a newer different run supersedes the older pending request, never the work
 * already in progress.
 */
export const enqueueLatestRayenClinicalFill = (
  key: string,
  task: QueueEntry['task']
): Promise<RayenClinicalFillQueueOutcome> => {
  if (active?.key === key) return active.promise;
  if (pending?.key === key) return pending.promise;

  const entry = createEntry(key, task, active !== null);
  if (!active) {
    start(entry);
    return entry.promise;
  }

  pending?.resolve('superseded');
  pending = entry;
  return entry.promise;
};

/** Test-only reset for module state isolated from React. */
export const resetRayenClinicalFillQueueForTests = (): void => {
  active = null;
  pending?.resolve('superseded');
  pending = null;
};
