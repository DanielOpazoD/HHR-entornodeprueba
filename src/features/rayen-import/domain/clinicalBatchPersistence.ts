import type {
  ClinicalFillBatchApplyResult,
  ClinicalFillBatchEvidence,
  ClinicalFillError,
  ClinicalFillPatchOperation,
  ClinicalFillPersistenceStrategy,
} from '../contracts/clinicalFillContracts';
import {
  buildClinicalFillError,
  classifyRayenSyncError,
  reportRayenSyncWarning,
} from '../observability/rayenSyncDiagnostics';

interface PersistClinicalBatchInput {
  operations: ClinicalFillPatchOperation[];
  diagnosticRunId?: string;
  strategy: ClinicalFillPersistenceStrategy;
  applyWithMetrics: (
    operation: () => Promise<ClinicalFillBatchApplyResult>
  ) => Promise<ClinicalFillBatchApplyResult>;
  recordRetries: (count: number) => void;
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
  diagnosticRunId,
  strategy,
  applyWithMetrics,
  recordRetries,
}: PersistClinicalBatchInput): Promise<PersistClinicalBatchResult> => {
  if (strategy.disposition === 'deferred' && operations.length > 0) {
    try {
      const result = await applyWithMetrics(() => strategy.persist(operations));
      recordRetries(result.retries ?? 0);
      const failedIndexes = new Set((result.failures ?? []).map(failure => failure.index));
      const clinicalTargets = operations.filter(
        (operation, index) => !failedIndexes.has(index) && (operation.clinicalFieldCount ?? 1) > 0
      ).length;
      return {
        patched: clinicalTargets,
        errors: (result.failures ?? []).flatMap(failure => {
          const operation = operations[failure.index];
          return operation
            ? [
                buildClinicalFillError({
                  bedId: operation.target.bedId,
                  clinicalEpisodeId: operation.target.clinicalEpisodeId,
                  source: 'patch',
                  error: failure.message,
                }),
              ]
            : [];
        }),
        batch: result.batch,
      };
    } catch (error) {
      recordRetries(retryCount(error));
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

  if (strategy.disposition === 'observe' && operations.length > 0) {
    try {
      const batch = await strategy.persist(operations);
      return { patched: 0, errors: [], batch };
    } catch (error) {
      reportRayenSyncWarning('clinical_batch_shadow_observation_failed', {
        runId: diagnosticRunId,
        errorKind: classifyRayenSyncError(error),
        patientCount: operations.length,
        batchMode: 'shadow',
      });
      return {
        patched: 0,
        errors: [],
        batch: {
          mode: 'shadow',
          parity: 'unavailable',
          clinicalTargets: operations.filter(item => (item.clinicalFieldCount ?? 1) > 0).length,
          checkpointTargets: operations.filter(item => item.checkpointChanged).length,
          checkpointOnlyTargets: operations.filter(
            item => (item.clinicalFieldCount ?? 1) === 0 && item.checkpointChanged
          ).length,
          requestedFields: operations.reduce(
            (total, item) =>
              total + (item.clinicalFieldCount ?? 1) + Number(item.checkpointChanged),
            0
          ),
        },
      };
    }
  }
  return { patched: 0, errors: [] };
};
