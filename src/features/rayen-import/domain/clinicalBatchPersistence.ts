import type {
  ClinicalFillBatchApplyResult,
  ClinicalFillBatchEvidence,
  ClinicalFillError,
  ClinicalFillPatchOperation,
  ClinicalFillPersistenceStrategy,
  ClinicalPersistenceEvidence,
} from '../contracts/clinicalFillContracts';
import {
  buildClinicalFillError,
  classifyRayenWriteCause,
} from '../observability/rayenSyncDiagnostics';
import {
  isClinicalBatchTransportFailure,
  operationLogicalTargetKey,
  readPersistenceFailureEvidence,
} from '../hooks/clinicalEnrichmentBatchExecutionSupport';

interface PersistClinicalBatchInput {
  operations: ClinicalFillPatchOperation[];
  strategy: ClinicalFillPersistenceStrategy;
  applyWithMetrics: (
    operation: () => Promise<ClinicalFillBatchApplyResult>
  ) => Promise<ClinicalFillBatchApplyResult>;
  recordRetries: (count: number) => void;
  recordPersistenceEvidence: (evidence: ClinicalPersistenceEvidence) => void;
  /** The run's stop signal: no second attempt once the run is cancelled. */
  signal?: AbortSignal;
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Measured 2026-11-06: a write turn failed in 0.6 s without reaching the server, right after a
 * page reload, and the same batch was saved by the next synchronization two minutes later. One
 * calm second attempt re-reads the census and rebuilds the batch, so it never writes twice.
 */
export const CLINICAL_BATCH_TRANSPORT_RETRY_DELAY_MS = 1500;

const waitFor = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });

interface PersistClinicalBatchResult {
  patched: number;
  errors: ClinicalFillError[];
  batch?: ClinicalFillBatchEvidence;
}

const retryCount = (error: unknown): number => {
  const retries = Number((error as { clinicalBatchRetries?: unknown })?.clinicalBatchRetries);
  return Number.isFinite(retries) && retries > 0 ? Math.floor(retries) : 0;
};

const patchError = (operation: ClinicalFillPatchOperation, error: unknown): ClinicalFillError =>
  buildClinicalFillError({
    bedId: operation.target.bedId,
    clinicalEpisodeId: operation.target.clinicalEpisodeId,
    source: 'patch',
    cause: classifyRayenWriteCause(error),
    error,
  });

/** Completes optional batch persistence without coupling its outcome mapping to the fill runner. */
export const persistClinicalBatch = async ({
  operations,
  strategy,
  applyWithMetrics,
  recordRetries,
  recordPersistenceEvidence,
  signal,
  wait = waitFor,
}: PersistClinicalBatchInput): Promise<PersistClinicalBatchResult> => {
  if (operations.length > 0) {
    const attempt = () => applyWithMetrics(() => strategy.persist(operations));
    try {
      let result: ClinicalFillBatchApplyResult;
      try {
        result = await attempt();
      } catch (error) {
        // Only a failure that got no answer is repeated; a server answer or a stale batch is final.
        if (!isClinicalBatchTransportFailure(error) || signal?.aborted) throw error;
        const evidence = readPersistenceFailureEvidence(error);
        if (evidence) recordPersistenceEvidence(evidence);
        recordRetries(1);
        await wait(CLINICAL_BATCH_TRANSPORT_RETRY_DELAY_MS, signal);
        if (signal?.aborted) throw error;
        result = await attempt();
      }
      if (result.persistence) recordPersistenceEvidence(result.persistence);
      else recordRetries(result.retries ?? 0);
      const excluded = new Map(
        (result.excludedTargets ?? []).map(({ target, error }) => [
          operationLogicalTargetKey({ target, patch: {} }),
          error,
        ])
      );
      const excludedError = (operation: ClinicalFillPatchOperation) =>
        excluded.get(operationLogicalTargetKey(operation));
      return {
        patched: operations.filter(
          operation => !excludedError(operation) && (operation.clinicalFieldCount ?? 1) > 0
        ).length,
        errors: operations.flatMap(operation => {
          const error = excludedError(operation);
          return error ? [patchError(operation, error)] : [];
        }),
        batch: result.batch,
      };
    } catch (error) {
      const persistenceEvidence = readPersistenceFailureEvidence(error);
      if (persistenceEvidence) recordPersistenceEvidence(persistenceEvidence);
      const retries = retryCount(error);
      if (!persistenceEvidence) recordRetries(retries);
      return {
        patched: 0,
        errors: operations.map(operation => patchError(operation, error)),
      };
    }
  }

  return { patched: 0, errors: [] };
};
