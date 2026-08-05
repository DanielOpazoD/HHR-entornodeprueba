import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type {
  ClinicalFillPatchOperation,
  ClinicalFillPersistenceStrategy,
} from '../contracts/clinicalFillContracts';
import type { ClinicalEnrichmentBatchMode } from '../domain/clinicalEnrichmentBatchMode';
import {
  applyClinicalEnrichmentBatch,
  observeClinicalEnrichmentBatch,
} from './applyClinicalEnrichmentBatch';
import { rebuildClinicalEnrichmentOperations } from '../domain/rebuildClinicalEnrichmentOperations';

interface CreateClinicalEnrichmentPersistenceStrategyInput {
  mode: ClinicalEnrichmentBatchMode;
  record: DailyRecord;
  runId: string;
  applyPatch: (operation: ClinicalFillPatchOperation) => Promise<void>;
  refreshRecord: () => Promise<DailyRecord>;
  applyBatch?: typeof applyClinicalEnrichmentBatch;
  observeBatch?: typeof observeClinicalEnrichmentBatch;
}

/** Selects one persistence owner once, before the clinical fill starts. */
export const createClinicalEnrichmentPersistenceStrategy = ({
  mode,
  record,
  runId,
  applyPatch,
  refreshRecord,
  applyBatch = applyClinicalEnrichmentBatch,
  observeBatch = observeClinicalEnrichmentBatch,
}: CreateClinicalEnrichmentPersistenceStrategyInput): ClinicalFillPersistenceStrategy => {
  if (mode === 'off') {
    return {
      disposition: 'immediate',
      persist: async () => undefined,
    };
  }

  if (mode === 'shadow') {
    return {
      disposition: 'observe',
      persist: async operations =>
        observeBatch({
          record: await refreshRecord(),
          runId,
          operations,
        }),
    };
  }

  return {
    disposition: 'deferred',
    persist: operations =>
      applyBatch({
        mode,
        record,
        runId,
        operations,
        rebuildOperations: currentRecord =>
          rebuildClinicalEnrichmentOperations({
            baseRecord: record,
            currentRecord,
            operations,
          }),
        applyPatch,
        refreshRecord,
      }),
  };
};
