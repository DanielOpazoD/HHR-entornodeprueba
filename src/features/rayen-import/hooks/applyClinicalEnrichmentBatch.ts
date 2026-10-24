import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type {
  ClinicalFillBatchApplyResult,
  ClinicalFillBatchEvidence,
  ClinicalFillPatchOperation,
} from '../contracts/clinicalFillContracts';
import {
  callRayenClinicalEnrichmentBatch,
  type RayenClinicalEnrichmentBatchPayload,
} from '../bridge/rayenClinicalEnrichmentBatchClient';
import type { ClinicalEnrichmentBatchMode } from '../domain/clinicalEnrichmentBatchMode';
import { createSyncMutationId } from '@/services/storage/sync/syncMutationIdentity';
import { runExclusiveDailyRecordWrite } from '@/services/repositories/dailyRecordWriteCoordinator';
import {
  prepareClinicalEnrichmentBatchPayload,
  summarizeClinicalEnrichmentSections,
} from './clinicalEnrichmentBatchPayload';
import {
  classifyRayenSyncError,
  reportRayenSyncWarning,
} from '../observability/rayenSyncDiagnostics';
import {
  assertCommittedResponse,
  applyLegacyClinicalEnrichmentOperations,
  buildBoundedClinicalBatchChunks,
  isClinicalBatchRetryableError,
  isClinicalBatchVersionConflict,
  mergeBatchEvidence,
  readReportedTransactionRetries,
  readServerTransactionRetries,
  resolveClinicalPersistenceScope,
  selectRebuiltChunkOperations,
  withClinicalBatchRetryCount,
  withPersistenceFailureEvidence,
  type BoundedClinicalBatchChunk,
} from './clinicalEnrichmentBatchExecutionSupport';

const authorityRevision = (record: DailyRecord): unknown =>
  (record as DailyRecord & { meta?: { revision?: unknown } }).meta?.revision;

interface ApplyClinicalEnrichmentBatchInput {
  mode: ClinicalEnrichmentBatchMode;
  record: DailyRecord;
  /** Record that owns the synchronization event when the target is the previous census day. */
  authorityDate?: string;
  runId: string;
  operations: ClinicalFillPatchOperation[];
  /** Revalidates original record-derived values at the write turn and after a version conflict. */
  rebuildOperations?: (record: DailyRecord) => ClinicalFillPatchOperation[];
  applyPatch: (operation: ClinicalFillPatchOperation) => Promise<void>;
  /** Must read server authority, without merging pending local projections. */
  refreshRecord: () => Promise<DailyRecord>;
  /** Local refresh after a committed batch; its result is unused. Defaults to `refreshRecord`. */
  refreshCommittedRecord?: () => Promise<unknown>;
  invoke?: typeof callRayenClinicalEnrichmentBatch;
  createMutationId?: () => string;
}

interface ObserveClinicalEnrichmentBatchInput {
  record: DailyRecord;
  runId: string;
  operations: ClinicalFillPatchOperation[];
  invoke?: typeof callRayenClinicalEnrichmentBatch;
  createMutationId?: () => string;
}

export const observeClinicalEnrichmentBatch = async ({
  record,
  runId,
  operations,
  invoke = callRayenClinicalEnrichmentBatch,
  createMutationId = createSyncMutationId,
}: ObserveClinicalEnrichmentBatchInput): Promise<ClinicalFillBatchEvidence> => {
  try {
    const chunks = buildBoundedClinicalBatchChunks({
      mode: 'shadow',
      record,
      runId,
      operations,
      createMutationId,
    });
    const evidence: ClinicalFillBatchEvidence[] = [];
    for (const chunk of chunks) {
      const prepared = prepareClinicalEnrichmentBatchPayload({
        mode: 'shadow',
        record,
        runId,
        operations: chunk.operations,
        mutationId: chunk.mutationId,
      });
      if (!prepared.payload) continue;
      const response = await invoke(prepared.payload);
      evidence.push(assertCommittedResponse(response, prepared.payload));
    }
    return mergeBatchEvidence(evidence, 'shadow');
  } catch (error) {
    reportRayenSyncWarning('clinical_batch_shadow_observation_failed', {
      batchRunId: runId,
      batchMode: 'shadow',
      errorKind: classifyRayenSyncError(error),
    });
    return prepareClinicalEnrichmentBatchPayload({
      mode: 'shadow',
      record,
      runId,
      operations,
      mutationId: createMutationId(),
    }).evidence;
  }
};

/** Executes one bounded authority call; enforced never changes persistence owner mid-run. */
export const applyClinicalEnrichmentBatch = async ({
  mode,
  record,
  authorityDate,
  runId,
  operations,
  rebuildOperations,
  applyPatch,
  refreshRecord,
  refreshCommittedRecord = refreshRecord,
  invoke = callRayenClinicalEnrichmentBatch,
  createMutationId = createSyncMutationId,
}: ApplyClinicalEnrichmentBatchInput): Promise<ClinicalFillBatchApplyResult> => {
  if (mode === 'off') {
    return applyLegacyClinicalEnrichmentOperations(operations, applyPatch);
  }
  const invokeChecked = async (
    payload: RayenClinicalEnrichmentBatchPayload
  ): Promise<{
    response: Awaited<ReturnType<typeof callRayenClinicalEnrichmentBatch>>;
    batch: ClinicalFillBatchEvidence;
  }> => {
    const response = await invoke(payload);
    const batch = assertCommittedResponse(response, payload);
    return { response, batch };
  };

  if (mode === 'shadow') {
    const legacy = await applyLegacyClinicalEnrichmentOperations(operations, applyPatch);
    let shadowRecord: DailyRecord;
    try {
      shadowRecord = await refreshRecord();
    } catch (error) {
      reportRayenSyncWarning('clinical_batch_shadow_refresh_failed', {
        runId,
        batchMode: 'shadow',
        errorKind: classifyRayenSyncError(error),
      });
      const { evidence } = prepareClinicalEnrichmentBatchPayload({
        mode,
        record,
        authorityDate,
        runId,
        operations,
        mutationId: createMutationId(),
      });
      return { ...legacy, batch: evidence };
    }
    let chunks: BoundedClinicalBatchChunk[];
    try {
      chunks = buildBoundedClinicalBatchChunks({
        mode,
        record: shadowRecord,
        authorityDate,
        runId,
        operations,
        createMutationId,
      });
    } catch (error) {
      reportRayenSyncWarning('clinical_batch_shadow_observation_failed', {
        batchRunId: runId,
        batchMode: 'shadow',
        errorKind: classifyRayenSyncError(error),
      });
      const { evidence } = prepareClinicalEnrichmentBatchPayload({
        mode,
        record: shadowRecord,
        authorityDate,
        runId,
        operations,
        mutationId: createMutationId(),
      });
      return { ...legacy, batch: evidence };
    }
    const batchEvidence: ClinicalFillBatchEvidence[] = [];
    for (const chunk of chunks) {
      const prepared = prepareClinicalEnrichmentBatchPayload({
        mode,
        record: shadowRecord,
        authorityDate,
        runId,
        operations: chunk.operations,
        mutationId: chunk.mutationId,
      });
      if (!prepared.payload) continue;
      const batch = await invokeChecked(prepared.payload)
        .then(result => result.batch)
        .catch(error => {
          reportRayenSyncWarning('clinical_batch_shadow_observation_failed', {
            batchRunId: runId,
            batchMode: 'shadow',
            errorKind: classifyRayenSyncError(error),
          });
          return summarizeClinicalEnrichmentSections(
            prepared.payload?.patches ?? [],
            prepared.payload?.checkpoints ?? [],
            'shadow'
          );
        });
      batchEvidence.push(batch);
    }
    return { ...legacy, batch: mergeBatchEvidence(batchEvidence, 'shadow') };
  }

  return runExclusiveDailyRecordWrite(
    record.date,
    async () => {
      // Source reads happen before this turn. Re-read only after earlier writers have settled,
      // and revalidate against the original base before constructing the atomic payload.
      const currentRecord = await refreshRecord();
      if (currentRecord.date !== record.date) {
        throw new Error('La lectura autoritativa corresponde a otra fecha del censo.');
      }
      const versionChanged =
        currentRecord.lastUpdated !== record.lastUpdated ||
        authorityRevision(currentRecord) !== authorityRevision(record);
      if (versionChanged && !rebuildOperations) {
        throw new Error('El censo cambió y el lote clínico debe reconstruirse antes de guardarlo.');
      }
      const currentOperations = rebuildOperations ? rebuildOperations(currentRecord) : operations;
      const chunks = buildBoundedClinicalBatchChunks({
        mode,
        record: currentRecord,
        authorityDate,
        runId,
        operations: currentOperations,
        createMutationId,
      });
      if (chunks.length === 0) {
        return {
          patientWrites: 0,
          historySnapshots: 0,
          batch: summarizeClinicalEnrichmentSections([], [], 'enforced'),
        };
      }
      if (chunks.length > 1) {
        throw new Error(
          'El lote clínico excede una transacción atómica segura; los datos quedaron pendientes.'
        );
      }
      let activeRecord = currentRecord;
      let patientWrites = 0;
      let historySnapshots = 0;
      let retries = 0;
      let callableAttempts = 0;
      let transactionRetries = 0;
      let transactionEvidenceComplete = true;
      const batchEvidence: ClinicalFillBatchEvidence[] = [];
      const chunk = chunks[0]!;
      let activeOperations = chunk.operations;
      let prepared = prepareClinicalEnrichmentBatchPayload({
        mode,
        record: activeRecord,
        authorityDate,
        runId,
        operations: activeOperations,
        mutationId: chunk.mutationId,
      });
      if (!prepared.payload) {
        throw new Error('No se pudo preparar el lote clínico transaccional.');
      }

      let activePayload = prepared.payload;
      let checked: Awaited<ReturnType<typeof invokeChecked>>;
      const invokeEnforced = async (payload: RayenClinicalEnrichmentBatchPayload) => {
        callableAttempts += 1;
        let response: Awaited<ReturnType<typeof callRayenClinicalEnrichmentBatch>>;
        try {
          response = await invoke(payload);
        } catch (error) {
          const reportedRetries = readServerTransactionRetries(error);
          if (reportedRetries == null) transactionEvidenceComplete = false;
          else transactionRetries += reportedRetries;
          throw error;
        }
        const reportedRetries = readReportedTransactionRetries(response);
        if (reportedRetries == null) transactionEvidenceComplete = false;
        else transactionRetries += reportedRetries;
        return { response, batch: assertCommittedResponse(response, payload) };
      };
      try {
        try {
          checked = await invokeEnforced(activePayload);
        } catch (error) {
          if (!isClinicalBatchVersionConflict(error) && !isClinicalBatchRetryableError(error)) {
            throw error;
          }
          retries += 1;
          if (isClinicalBatchVersionConflict(error)) {
            activeRecord = await refreshRecord();
            if (!rebuildOperations) {
              throw error;
            }
            activeOperations = selectRebuiltChunkOperations(
              rebuildOperations(activeRecord),
              chunk.operations
            );
            prepared = prepareClinicalEnrichmentBatchPayload({
              mode,
              record: activeRecord,
              authorityDate,
              runId,
              operations: activeOperations,
              // A rejected authority check did not consume this identity. Reusing it also preserves
              // idempotency if the first response was lost after a concurrent transaction retry.
              mutationId: activePayload.mutationId,
            });
            if (!prepared.payload) {
              if (prepared.evidence.requestedFields === 0) {
                return {
                  patientWrites: 0,
                  historySnapshots: 0,
                  retries,
                  ...(transactionEvidenceComplete
                    ? {
                        persistence: {
                          scope: resolveClinicalPersistenceScope(activePayload),
                          callableAttempts,
                          clientRetries: retries,
                          transactionRetries,
                        },
                      }
                    : {}),
                  batch: prepared.evidence,
                };
              }
              throw new Error('No se pudo reconstruir el lote clínico contra el censo vigente.');
            }
            activePayload = prepared.payload;
          }
          checked = await invokeEnforced(activePayload);
        }
      } catch (error) {
        if (!transactionEvidenceComplete) {
          throw withClinicalBatchRetryCount(error, retries);
        }
        throw withPersistenceFailureEvidence(error, {
          scope: resolveClinicalPersistenceScope(activePayload),
          callableAttempts,
          clientRetries: retries,
          transactionRetries,
        });
      }

      const response = checked.response;
      const scope = response.targetScope ?? resolveClinicalPersistenceScope(activePayload);
      if (response.authorityStatus === 'ok') {
        patientWrites += response.patientWrites ?? 1;
        historySnapshots += response.historySnapshots ?? Number(activePayload.patches.length > 0);
      }
      batchEvidence.push(checked.batch);

      try {
        await refreshCommittedRecord();
      } catch (error) {
        reportRayenSyncWarning('clinical_batch_local_refresh_deferred', {
          runId,
          batchMode: 'enforced',
          errorKind: classifyRayenSyncError(error),
        });
      }

      return {
        patientWrites,
        historySnapshots,
        retries,
        ...(transactionEvidenceComplete
          ? {
              persistence: {
                scope,
                callableAttempts,
                clientRetries: retries,
                transactionRetries,
              },
            }
          : {}),
        batch: mergeBatchEvidence(batchEvidence, 'enforced'),
      };
    },
    { kind: 'clinical_sync' }
  );
};
