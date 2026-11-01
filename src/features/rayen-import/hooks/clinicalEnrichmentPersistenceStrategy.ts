import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type { ClinicalFillPersistenceStrategy } from '../contracts/clinicalFillContracts';
import type { ClinicalEnrichmentBatchMode } from '../domain/clinicalEnrichmentBatchMode';
import { applyClinicalEnrichmentBatch } from './applyClinicalEnrichmentBatch';
import { rebuildClinicalEnrichmentOperations } from '../domain/rebuildClinicalEnrichmentOperations';

interface CreateClinicalEnrichmentPersistenceStrategyInput {
  mode: ClinicalEnrichmentBatchMode;
  record: DailyRecord;
  runId: string;
  refreshRecord: () => Promise<DailyRecord>;
  /** Local refresh after a committed enforced batch; defaults to `refreshRecord`. */
  refreshCommittedRecord?: () => Promise<unknown>;
  applyBatch?: typeof applyClinicalEnrichmentBatch;
  rebuildOperations?: typeof rebuildClinicalEnrichmentOperations;
}

/** Selects one persistence owner once, before the clinical fill starts. */
export const createClinicalEnrichmentPersistenceStrategy = ({
  mode,
  record,
  runId,
  refreshRecord,
  refreshCommittedRecord,
  applyBatch = applyClinicalEnrichmentBatch,
  rebuildOperations = rebuildClinicalEnrichmentOperations,
}: CreateClinicalEnrichmentPersistenceStrategyInput): ClinicalFillPersistenceStrategy => {
  return {
    disposition: 'deferred',
    persist: operations =>
      applyBatch({
        mode,
        record,
        runId,
        operations,
        rebuildOperations: currentRecord =>
          rebuildOperations({ baseRecord: record, currentRecord, operations }),
        refreshRecord,
        ...(refreshCommittedRecord ? { refreshCommittedRecord } : {}),
      }),
  };
};
