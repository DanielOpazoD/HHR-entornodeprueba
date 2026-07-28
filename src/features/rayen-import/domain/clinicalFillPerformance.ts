import type {
  ClinicalWriteMetrics,
  ClinicalWritePerformanceObserver,
} from './clinicalWriteCoordinator';
import type { RayenSyncPerformance } from '@/types/domain/rayenSync';
import { elapsedMilliseconds, isRayenTimeoutMessage } from './rayenSyncPerformance';

/** Request-scoped aggregate collector. Its API accepts no patient or clinical values. */
export const createClinicalFillPerformance = (now: () => number = Date.now) => {
  let firstReadAt: number | null = null;
  let clinicalReadsMs = 0;
  let requests = 0;
  let writeQueueWaitMs = 0;
  let persistenceMs = 0;
  let historicalPatches = 0;
  let timeouts = 0;

  const recordTimeout = (value: unknown): void => {
    if (isRayenTimeoutMessage(value)) timeouts += 1;
  };

  const trackRequest = async <T>(operation: () => Promise<T>): Promise<T> => {
    firstReadAt ??= now();
    requests += 1;
    try {
      return await operation();
    } catch (error) {
      recordTimeout(error);
      throw error;
    } finally {
      clinicalReadsMs = elapsedMilliseconds(firstReadAt, now());
    }
  };

  const writeObserver: ClinicalWritePerformanceObserver = {
    now,
    onWait: durationMs => {
      writeQueueWaitMs += durationMs;
    },
    onPersistence: durationMs => {
      persistenceMs += durationMs;
    },
  };

  const recordHistoricalPatch = (): void => {
    historicalPatches += 1;
  };

  const finish = (writeMetrics: ClinicalWriteMetrics): RayenSyncPerformance => ({
    stagesMs: {
      clinicalReads: clinicalReadsMs,
      writeQueueWait: writeQueueWaitMs,
      persistence: persistenceMs,
    },
    counters: {
      requests,
      cacheHits: 0,
      patches: writeMetrics.patientWrites + historicalPatches,
      retries: 0,
      timeouts,
    },
  });

  return { trackRequest, recordTimeout, writeObserver, recordHistoricalPatch, finish };
};
