import type {
  ClinicalFillBatchApplyResult,
  ClinicalFillBatchEvidence,
  ClinicalFillError,
  ClinicalFillPatchOperation,
  ClinicalFillPersistenceStrategy,
  ClinicalPersistenceEvidence,
} from '../contracts/clinicalFillContracts';
import { buildClinicalFillError } from '../observability/rayenSyncDiagnostics';
import { readPersistenceFailureEvidence } from '../hooks/clinicalEnrichmentBatchExecutionSupport';

interface PersistClinicalBatchInput {
  operations: ClinicalFillPatchOperation[];
  strategy: ClinicalFillPersistenceStrategy;
  applyWithMetrics: (
    operation: () => Promise<ClinicalFillBatchApplyResult>
  ) => Promise<ClinicalFillBatchApplyResult>;
  recordRetries: (count: number) => void;
  recordPersistenceEvidence: (evidence: ClinicalPersistenceEvidence) => void;
}

interface PersistClinicalBatchResult {
  patched: number;
  errors: ClinicalFillError[];
  batch?: ClinicalFillBatchEvidence;
}

const retryCount = (error: unknown): number => {
  const retries = Number((error as { clinicalBatchRetries?: unknown })?.clinicalBatchRetries);
  return Number.isFinite(retries) && retries > 0 ? Math.floor(retries) : 0;
};

/** Completes optional batch persistence without coupling its outcome mapping to the fill runner. */
export const persistClinicalBatch = async ({
  operations,
  strategy,
  applyWithMetrics,
  recordRetries,
  recordPersistenceEvidence,
}: PersistClinicalBatchInput): Promise<PersistClinicalBatchResult> => {
  if (operations.length > 0) {
    try {
      const result = await applyWithMetrics(() => strategy.persist(operations));
      if (result.persistence) recordPersistenceEvidence(result.persistence);
      else recordRetries(result.retries ?? 0);
      return {
        patched: operations.filter(operation => (operation.clinicalFieldCount ?? 1) > 0).length,
        errors: [],
        batch: result.batch,
      };
    } catch (error) {
      const persistenceEvidence = readPersistenceFailureEvidence(error);
      if (persistenceEvidence) recordPersistenceEvidence(persistenceEvidence);
      const retries = retryCount(error);
      if (!persistenceEvidence) recordRetries(retries);
      return {
        patched: 0,
        errors: operations.map(operation =>
          buildClinicalFillError({
            bedId: operation.target.bedId,
            clinicalEpisodeId: operation.target.clinicalEpisodeId,
            source: 'patch',
            error,
          })
        ),
      };
    }
  }

  return { patched: 0, errors: [] };
};
