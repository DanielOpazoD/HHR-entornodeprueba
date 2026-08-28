export interface ClinicalWriteMetrics {
  patientWrites: number;
  historySnapshots: number;
}

interface ClinicalBatchWriteMetrics {
  patientWrites: number;
  historySnapshots: number;
}

export interface ClinicalWritePerformanceObserver {
  now: () => number;
  onWait: (durationMs: number) => void;
  onPersistence: (durationMs: number, scope: 'current' | 'historical') => void;
}

export const createClinicalWriteCoordinator = (
  metrics: ClinicalWriteMetrics,
  observer?: ClinicalWritePerformanceObserver
) => {
  let queue: Promise<void> = Promise.resolve();
  let historySnapshotCaptured = false;
  const enqueue = <T>(
    operation: () => Promise<T>,
    options: { scope?: 'current' | 'historical' } = {}
  ): Promise<T> => {
    const queuedAt = observer?.now();
    const pending = queue.then(async () => {
      if (queuedAt != null) observer?.onWait(observer.now() - queuedAt);
      const startedAt = observer?.now();
      try {
        return await operation();
      } finally {
        if (startedAt != null) {
          observer?.onPersistence(observer.now() - startedAt, options.scope ?? 'current');
        }
      }
    });
    queue = pending.then(
      () => undefined,
      () => undefined
    );
    return pending;
  };

  const applyPatientPatch = (
    operation: (captureHistorySnapshot: boolean) => Promise<void>,
    options: { clinicalChange?: boolean } = {}
  ) =>
    enqueue(
      async () => {
        const captureHistorySnapshot = options.clinicalChange !== false && !historySnapshotCaptured;
        await operation(captureHistorySnapshot);
        if (captureHistorySnapshot) {
          historySnapshotCaptured = true;
          metrics.historySnapshots += 1;
        }
        metrics.patientWrites += 1;
      },
      { scope: 'current' }
    );

  const applyBatch = <T extends ClinicalBatchWriteMetrics>(
    operation: () => Promise<T>,
    options: { scope?: 'current' | 'historical' } = {}
  ) =>
    enqueue(async () => {
      const result = await operation();
      metrics.patientWrites += result.patientWrites;
      metrics.historySnapshots += result.historySnapshots;
      return result;
    }, options);

  return { enqueue, applyPatientPatch, applyBatch };
};
