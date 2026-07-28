export interface ClinicalWriteMetrics {
  patientWrites: number;
  historySnapshots: number;
}

export interface ClinicalWritePerformanceObserver {
  now: () => number;
  onWait: (durationMs: number) => void;
  onPersistence: (durationMs: number) => void;
}

export const createClinicalWriteCoordinator = (
  metrics: ClinicalWriteMetrics,
  observer?: ClinicalWritePerformanceObserver
) => {
  let queue: Promise<void> = Promise.resolve();
  let historySnapshotCaptured = false;
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const queuedAt = observer?.now();
    const pending = queue.then(async () => {
      if (queuedAt != null) observer?.onWait(observer.now() - queuedAt);
      const startedAt = observer?.now();
      try {
        return await operation();
      } finally {
        if (startedAt != null) observer?.onPersistence(observer.now() - startedAt);
      }
    });
    queue = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  };

  const applyPatientPatch = (operation: (captureHistorySnapshot: boolean) => Promise<void>) =>
    enqueue(async () => {
      const captureHistorySnapshot = !historySnapshotCaptured;
      await operation(captureHistorySnapshot);
      if (captureHistorySnapshot) {
        historySnapshotCaptured = true;
        metrics.historySnapshots += 1;
      }
      metrics.patientWrites += 1;
    });

  return { enqueue, applyPatientPatch };
};
