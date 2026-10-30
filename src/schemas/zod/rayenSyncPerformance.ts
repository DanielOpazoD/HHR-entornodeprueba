import * as z from 'zod';
import { nullableOptional } from './helpers';

const NonNegativeIntegerSchema = z.number().int().nonnegative();
const OptionalNonNegativeIntegerSchema = nullableOptional(NonNegativeIntegerSchema);

const PersistenceTraceSchema = z.object({
  callableAttempts: NonNegativeIntegerSchema,
  clientRetries: NonNegativeIntegerSchema,
  transactionRetries: NonNegativeIntegerSchema,
});

export const RayenSyncPerformanceSchema = z.object({
  stagesMs: z.object({
    preflight: OptionalNonNegativeIntegerSchema,
    dualCapture: OptionalNonNegativeIntegerSchema,
    captureHealthBefore: OptionalNonNegativeIntegerSchema,
    captureFichaMedico: OptionalNonNegativeIntegerSchema,
    fichaContext: OptionalNonNegativeIntegerSchema,
    fichaListsAndCatalog: OptionalNonNegativeIntegerSchema,
    fichaPatientReads: OptionalNonNegativeIntegerSchema,
    fichaDiagnosisCoding: OptionalNonNegativeIntegerSchema,
    captureGestionCamas: OptionalNonNegativeIntegerSchema,
    captureHealthAfter: OptionalNonNegativeIntegerSchema,
    reconciliation: OptionalNonNegativeIntegerSchema,
    historicalEvidence: OptionalNonNegativeIntegerSchema,
    reviewWait: OptionalNonNegativeIntegerSchema,
    structuralPersistence: OptionalNonNegativeIntegerSchema,
    clinicalReads: OptionalNonNegativeIntegerSchema,
    writeQueueWait: OptionalNonNegativeIntegerSchema,
    persistence: OptionalNonNegativeIntegerSchema,
    currentClinicalPersistence: OptionalNonNegativeIntegerSchema,
    historicalCudyrPersistence: OptionalNonNegativeIntegerSchema,
  }),
  counters: z.object({
    requests: NonNegativeIntegerSchema,
    cacheHits: NonNegativeIntegerSchema,
    patches: NonNegativeIntegerSchema,
    retries: NonNegativeIntegerSchema,
    timeouts: NonNegativeIntegerSchema,
    administrativeOverridesPreserved: OptionalNonNegativeIntegerSchema,
  }),
  sourceQuality: nullableOptional(
    z.object({
      treatingPhysicians: nullableOptional(
        z.object({
          encounters: NonNegativeIntegerSchema,
          catalogEntries: NonNegativeIntegerSchema,
          assignedEncounters: NonNegativeIntegerSchema,
          sourceResolvedNames: NonNegativeIntegerSchema,
          plannedResolvedNames: NonNegativeIntegerSchema,
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
