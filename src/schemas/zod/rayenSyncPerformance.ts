import { z } from 'zod';
import { nullableOptional } from './helpers';

const PersistenceTraceSchema = z.object({
  callableAttempts: z.number().int().nonnegative(),
  clientRetries: z.number().int().nonnegative(),
  transactionRetries: z.number().int().nonnegative(),
});

export const RayenSyncPerformanceSchema = z.object({
  stagesMs: z.object({
    preflight: nullableOptional(z.number().int().nonnegative()),
    dualCapture: nullableOptional(z.number().int().nonnegative()),
    reconciliation: nullableOptional(z.number().int().nonnegative()),
    historicalEvidence: nullableOptional(z.number().int().nonnegative()),
    reviewWait: nullableOptional(z.number().int().nonnegative()),
    structuralPersistence: nullableOptional(z.number().int().nonnegative()),
    clinicalReads: nullableOptional(z.number().int().nonnegative()),
    writeQueueWait: nullableOptional(z.number().int().nonnegative()),
    persistence: nullableOptional(z.number().int().nonnegative()),
    currentClinicalPersistence: nullableOptional(z.number().int().nonnegative()),
    historicalCudyrPersistence: nullableOptional(z.number().int().nonnegative()),
  }),
  counters: z.object({
    requests: z.number().int().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
    patches: z.number().int().nonnegative(),
    retries: z.number().int().nonnegative(),
    timeouts: z.number().int().nonnegative(),
  }),
  sourceQuality: nullableOptional(
    z.object({
      treatingPhysicians: nullableOptional(
        z.object({
          encounters: z.number().int().nonnegative(),
          catalogEntries: z.number().int().nonnegative(),
          assignedEncounters: z.number().int().nonnegative(),
          sourceResolvedNames: z.number().int().nonnegative(),
          plannedResolvedNames: z.number().int().nonnegative(),
        })
      ),
    })
  ),
  persistenceTrace: nullableOptional(
    z.object({
      current: nullableOptional(PersistenceTraceSchema),
      historical: nullableOptional(PersistenceTraceSchema),
    })
  ),
});
