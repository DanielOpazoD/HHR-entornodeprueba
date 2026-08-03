import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type {
  ClinicalFillPatchOperation,
  ClinicalFillPersistenceStrategy,
} from '../contracts/clinicalFillContracts';
import type { ClinicalEnrichmentBatchMode } from '../domain/clinicalEnrichmentBatchMode';
import { createSyncMutationId } from '@/services/storage/sync/syncMutationIdentity';
import {
  applyClinicalEnrichmentBatch,
  observeClinicalEnrichmentBatch,
} from './applyClinicalEnrichmentBatch';

interface CreateClinicalEnrichmentPersistenceStrategyInput {
  mode: ClinicalEnrichmentBatchMode;
  record: DailyRecord;
  applyPatch: (operation: ClinicalFillPatchOperation) => Promise<void>;
  refreshRecord: () => Promise<DailyRecord>;
  createRunId?: () => string;
  applyBatch?: typeof applyClinicalEnrichmentBatch;
  observeBatch?: typeof observeClinicalEnrichmentBatch;
}

/** Selects one persistence owner once, before the clinical fill starts. */
export const createClinicalEnrichmentPersistenceStrategy = ({
  mode,
  record,
  applyPatch,
  refreshRecord,
  createRunId = () => `clinical_${createSyncMutationId()}`,
  applyBatch = applyClinicalEnrichmentBatch,
  observeBatch = observeClinicalEnrichmentBatch,
}: CreateClinicalEnrichmentPersistenceStrategyInput): ClinicalFillPersistenceStrategy => {
  if (mode === 'off') {
    return {
      disposition: 'immediate',
      persist: async () => undefined,
    };
  }

  const runId = createRunId();
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
        applyPatch,
        refreshRecord,
      }),
  };
};
