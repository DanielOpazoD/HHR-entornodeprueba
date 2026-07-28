import type {
  ClinicalFillBatchApplyResult,
  ClinicalFillError,
  ClinicalFillPatchOperation,
} from '../contracts/clinicalFillContracts';

interface PersistClinicalBatchInput {
  operations: ClinicalFillPatchOperation[];
  applyBatch?: (operations: ClinicalFillPatchOperation[]) => Promise<ClinicalFillBatchApplyResult>;
  observeBatch?: (operations: ClinicalFillPatchOperation[]) => Promise<void>;
  applyWithMetrics: (
    operation: () => Promise<ClinicalFillBatchApplyResult>
  ) => Promise<ClinicalFillBatchApplyResult>;
  recordRetries: (count: number) => void;
}

interface PersistClinicalBatchResult {
  patched: number;
  errors: ClinicalFillError[];
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error || 'Error desconocido');

const retryCount = (error: unknown): number => {
  const retries = Number((error as { clinicalBatchRetries?: unknown })?.clinicalBatchRetries);
  return Number.isFinite(retries) && retries > 0 ? Math.floor(retries) : 0;
};

/** Completes optional batch persistence without coupling its outcome mapping to the fill runner. */
export const persistClinicalBatch = async ({
  operations,
  applyBatch,
  observeBatch,
  applyWithMetrics,
  recordRetries,
}: PersistClinicalBatchInput): Promise<PersistClinicalBatchResult> => {
  if (applyBatch && operations.length > 0) {
    try {
      const result = await applyWithMetrics(() => applyBatch(operations));
      recordRetries(result.retries ?? 0);
      const failedIndexes = new Set((result.failures ?? []).map(failure => failure.index));
      return {
        patched: operations.length - failedIndexes.size,
        errors: (result.failures ?? []).flatMap(failure => {
          const operation = operations[failure.index];
          return operation
            ? [{ bedId: operation.target.bedId, source: 'patch', message: failure.message }]
            : [];
        }),
      };
    } catch (error) {
      recordRetries(retryCount(error));
      return {
        patched: 0,
        errors: operations.map(operation => ({
          bedId: operation.target.bedId,
          source: 'patch',
          message: message(error),
        })),
      };
    }
  }

  if (observeBatch && operations.length > 0) {
    void observeBatch(operations).catch(error => {
      console.warn(
        '[rayen-import] observación shadow del lote clínico no disponible:',
        message(error)
      );
    });
  }
  return { patched: 0, errors: [] };
};
