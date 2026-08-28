import type {
  ClinicalWriteMetrics,
  ClinicalWritePerformanceObserver,
} from './clinicalWriteCoordinator';
import type { RayenSyncPerformance } from '@/types/domain/rayenSync';
import type { ClinicalPersistenceEvidence } from '../contracts/clinicalFillContracts';
import { elapsedMilliseconds, isRayenTimeoutMessage } from './rayenSyncPerformance';

/** Request-scoped aggregate collector. Its API accepts no patient or clinical values. */
export const createClinicalFillPerformance = (now: () => number = Date.now) => {
  let firstReadAt: number | null = null;
  let clinicalReadsMs = 0;
  let requests = 0;
  let writeQueueWaitMs = 0;
  let persistenceMs = 0;
  let currentClinicalPersistenceMs = 0;
  let historicalCudyrPersistenceMs = 0;
  let currentClinicalPersistenceObserved = false;
  let historicalCudyrPersistenceObserved = false;
  const persistenceTrace: NonNullable<RayenSyncPerformance['persistenceTrace']> = {};
  let historicalPatches = 0;
  let administrativeOverridesPreserved = 0;
  let retries = 0;
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
    onPersistence: (durationMs, scope) => {
      persistenceMs += durationMs;
      if (scope === 'historical') {
        historicalCudyrPersistenceObserved = true;
        historicalCudyrPersistenceMs += durationMs;
      } else {
        currentClinicalPersistenceObserved = true;
        currentClinicalPersistenceMs += durationMs;
      }
    },
  };

  const recordHistoricalPatch = (): void => {
    historicalPatches += 1;
  };

  const recordAdministrativeOverridePreserved = (): void => {
    administrativeOverridesPreserved += 1;
  };

  const recordRetries = (count: number): void => {
    if (Number.isFinite(count) && count > 0) retries += Math.floor(count);
  };

  const recordPersistenceEvidence = (evidence: ClinicalPersistenceEvidence): void => {
    const current = persistenceTrace[evidence.scope];
    persistenceTrace[evidence.scope] = {
      callableAttempts: (current?.callableAttempts ?? 0) + evidence.callableAttempts,
      clientRetries: (current?.clientRetries ?? 0) + evidence.clientRetries,
      transactionRetries: (current?.transactionRetries ?? 0) + evidence.transactionRetries,
    };
    recordRetries(evidence.clientRetries + evidence.transactionRetries);
  };

  const finish = (
    writeMetrics: ClinicalWriteMetrics,
    cacheHits: number = 0
  ): RayenSyncPerformance => {
    const stagesMs: RayenSyncPerformance['stagesMs'] = {
      clinicalReads: clinicalReadsMs,
      writeQueueWait: writeQueueWaitMs,
      persistence: persistenceMs,
      ...(currentClinicalPersistenceObserved
        ? { currentClinicalPersistence: currentClinicalPersistenceMs }
        : {}),
      ...(historicalCudyrPersistenceObserved
        ? { historicalCudyrPersistence: historicalCudyrPersistenceMs }
        : {}),
    };
    return {
      stagesMs,
      counters: {
        requests,
        cacheHits,
        patches: writeMetrics.patientWrites + historicalPatches,
        retries,
        timeouts,
        ...(administrativeOverridesPreserved > 0 ? { administrativeOverridesPreserved } : {}),
      },
      ...(Object.keys(persistenceTrace).length > 0 ? { persistenceTrace } : {}),
    };
  };

  return {
    trackRequest,
    recordTimeout,
    writeObserver,
    recordHistoricalPatch,
    recordAdministrativeOverridePreserved,
    recordRetries,
    recordPersistenceEvidence,
    finish,
  };
};
