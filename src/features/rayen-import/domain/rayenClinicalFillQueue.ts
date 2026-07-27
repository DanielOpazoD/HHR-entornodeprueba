export type RayenClinicalFillQueueOutcome = 'completed' | 'drained' | 'superseded';

interface QueueEntry {
  key: string;
  task: () => Promise<void>;
  promise: Promise<RayenClinicalFillQueueOutcome>;
  resolve: (outcome: RayenClinicalFillQueueOutcome) => void;
}

let active: QueueEntry | null = null;
let pending: QueueEntry | null = null;

const createEntry = (key: string, task: () => Promise<void>): QueueEntry => {
  let resolve!: QueueEntry['resolve'];
  const promise = new Promise<RayenClinicalFillQueueOutcome>(settle => {
    resolve = settle;
  });
  return { key, task, promise, resolve };
};

const start = (entry: QueueEntry): void => {
  active = entry;
  void entry
    .task()
    .catch(error => {
      // The task owns its clinical/audit error reporting. This guard only keeps the queue live.
      console.warn('[rayen-import] ejecución clínica en cola falló:', error);
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
  task: () => Promise<void>
): Promise<RayenClinicalFillQueueOutcome> => {
  if (active?.key === key) return active.promise;
  if (pending?.key === key) return pending.promise;

  const entry = createEntry(key, task);
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
