export interface ClinicalWriteMetrics {
  patientWrites: number;
  historySnapshots: number;
}

export const createClinicalWriteCoordinator = (metrics: ClinicalWriteMetrics) => {
  let queue: Promise<void> = Promise.resolve();
  let historySnapshotCaptured = false;
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = queue.then(operation);
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
