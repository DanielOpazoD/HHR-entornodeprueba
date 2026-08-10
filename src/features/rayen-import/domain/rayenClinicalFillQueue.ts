import {
  classifyRayenSyncError,
  reportRayenSyncWarning,
} from '../observability/rayenSyncDiagnostics';
import type { ClinicalStageResult } from '../contracts/clinicalStageResult';

export type RayenClinicalFillQueueOutcome = 'completed' | 'drained' | 'superseded';

export interface RayenClinicalFillQueueResult {
  outcome: RayenClinicalFillQueueOutcome;
  result?: ClinicalStageResult;
}

export interface RayenClinicalFillQueueContext {
  startedAfterQueue: boolean;
}

interface QueueEntry {
  date: string;
  key: string;
  task: (context: RayenClinicalFillQueueContext) => Promise<ClinicalStageResult>;
  startedAfterQueue: boolean;
  promise: Promise<RayenClinicalFillQueueResult>;
  resolve: (outcome: RayenClinicalFillQueueResult) => void;
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
  const promise = new Promise<RayenClinicalFillQueueResult>(settle => {
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
  let taskPromise: Promise<ClinicalStageResult>;
  try {
    taskPromise = entry.task({ startedAfterQueue: entry.startedAfterQueue });
  } catch (error) {
    taskPromise = Promise.reject(error);
  }
  let taskResult: ClinicalStageResult | undefined;
  void taskPromise
    .then(result => {
      taskResult = result;
    })
    // The task owns expected clinical/audit failures. This guard records unexpected escapes while
    // preserving queue liveness and never includes the raw provider error.
    .catch(error => {
      reportRayenSyncWarning('clinical_fill_queue_task_failed', {
        date: entry.date,
        errorKind: classifyRayenSyncError(error),
      });
    })
    .finally(() => {
      active = null;
      const next = takeNextPending();
      if (next) {
        entry.resolve({ outcome: 'completed', result: taskResult });
        start(next);
      } else {
        entry.resolve({ outcome: 'drained', result: taskResult });
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
): Promise<RayenClinicalFillQueueResult> => {
  if (active?.date === date && active.key === key) return active.promise;
  const pendingForDate = pendingByDate.get(date);
  if (pendingForDate?.key === key) return pendingForDate.promise;

  const entry = createEntry(date, key, task, active !== null);
  if (!active) {
    start(entry);
    return entry.promise;
  }

  pendingForDate?.resolve({ outcome: 'superseded' });
  pendingByDate.set(date, entry);
  return entry.promise;
};

/** Test-only reset for module state isolated from React. */
export const resetRayenClinicalFillQueueForTests = (): void => {
  active = null;
  pendingByDate.forEach(entry => entry.resolve({ outcome: 'superseded' }));
  pendingByDate.clear();
};
