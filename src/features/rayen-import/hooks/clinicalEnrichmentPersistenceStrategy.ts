import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type {
  ClinicalFillBatchApplyResult,
  ClinicalFillPersistenceStrategy,
} from '../contracts/clinicalFillContracts';
import type { ClinicalEnrichmentBatchMode } from '../domain/clinicalEnrichmentBatchMode';
import { applyClinicalEnrichmentBatch } from './applyClinicalEnrichmentBatch';
import { rebuildClinicalEnrichmentOperations } from '../domain/rebuildClinicalEnrichmentOperations';
import { operationLogicalTargetKey } from './clinicalEnrichmentBatchExecutionSupport';

interface CreateClinicalEnrichmentPersistenceStrategyInput {
  checkSession?: () => void;
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
  checkSession,
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
    persist: async operations => {
      // A target left out of any rebuild of this attempt was not written, even if a later rebuild
      // would accept it: the retried chunk keeps only the targets it started with.
      const excluded = new Map<
        string,
        NonNullable<ClinicalFillBatchApplyResult['excludedTargets']>[number]
      >();
      const result = await applyBatch({
        checkSession,
        mode,
        record,
        runId,
        operations,
        rebuildOperations: currentRecord =>
          rebuildOperations({
            baseRecord: record,
            currentRecord,
            operations,
            onFieldConflict: (operation, error) =>
              excluded.set(operationLogicalTargetKey(operation), {
                target: operation.target,
                error,
              }),
          }),
        refreshRecord,
        ...(refreshCommittedRecord ? { refreshCommittedRecord } : {}),
      });
      return excluded.size > 0 ? { ...result, excludedTargets: [...excluded.values()] } : result;
    },
  };
};
