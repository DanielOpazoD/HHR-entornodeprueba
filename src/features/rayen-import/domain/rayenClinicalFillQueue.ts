import {
  classifyRayenSyncError,
  reportRayenSyncWarning,
} from '../observability/rayenSyncDiagnostics';

export type RayenClinicalFillQueueOutcome = 'completed' | 'drained' | 'superseded';

export interface RayenClinicalFillQueueContext {
  startedAfterQueue: boolean;
}

interface QueueEntry {
  date: string;
  key: string;
  task: (context: RayenClinicalFillQueueContext) => Promise<void>;
  startedAfterQueue: boolean;
  promise: Promise<RayenClinicalFillQueueOutcome>;
  resolve: (outcome: RayenClinicalFillQueueOutcome) => void;
}

let active: QueueEntry | null = null;
const pendingByDate = new Map<string, QueueEntry>();

const createEntry = (
  date: string,
  key: string,
  task: QueueEntry['task'],
  startedAfterQueue: boolean
): QueueEntry => {
  let resolve!: QueueEntry['resolve'];
  const promise = new Promise<RayenClinicalFillQueueOutcome>(settle => {
    resolve = settle;
  });
  return { date, key, task, startedAfterQueue, promise, resolve };
};

const takeNextPending = (): QueueEntry | null => {
  const next = pendingByDate.entries().next();
  if (next.done) return null;
  const [date, entry] = next.value;
  pendingByDate.delete(date);
  return entry;
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
      const next = takeNextPending();
      if (next) {
        entry.resolve('completed');
        start(next);
      } else {
        entry.resolve('drained');
      }
    });
};

/**
 * Single active clinical fill plus one latest pending fill per census date. Repeated requests for
 * the same applied run share one promise; a newer run supersedes only the pending request for its
 * own date, never another census day or the work already in progress.
 */
export const enqueueLatestRayenClinicalFill = (
  date: string,
  key: string,
  task: QueueEntry['task']
): Promise<RayenClinicalFillQueueOutcome> => {
  if (active?.key === key) return active.promise;
  const pendingForDate = pendingByDate.get(date);
  if (pendingForDate?.key === key) return pendingForDate.promise;

  const entry = createEntry(date, key, task, active !== null);
  if (!active) {
    start(entry);
    return entry.promise;
  }

  pendingForDate?.resolve('superseded');
  pendingByDate.set(date, entry);
  return entry.promise;
};

/** Test-only reset for module state isolated from React. */
export const resetRayenClinicalFillQueueForTests = (): void => {
  active = null;
  pendingByDate.forEach(entry => entry.resolve('superseded'));
  pendingByDate.clear();
};
