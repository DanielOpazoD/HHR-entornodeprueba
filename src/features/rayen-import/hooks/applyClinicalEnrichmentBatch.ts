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
  /** Must read server authority, without merging pending local projections. */
  refreshRecord: () => Promise<DailyRecord>;
  /** Local refresh after a committed batch; its result is unused. Defaults to `refreshRecord`. */
  refreshCommittedRecord?: () => Promise<unknown>;
  invoke?: typeof callRayenClinicalEnrichmentBatch;
  createMutationId?: () => string;
}

/** Executes one bounded authority call; enforced never changes persistence owner mid-run. */
export const applyClinicalEnrichmentBatch = async ({
  mode,
  record,
  authorityDate,
  runId,
  operations,
  rebuildOperations,
  refreshRecord,
  refreshCommittedRecord = refreshRecord,
  invoke = callRayenClinicalEnrichmentBatch,
  createMutationId = createSyncMutationId,
}: ApplyClinicalEnrichmentBatchInput): Promise<ClinicalFillBatchApplyResult> => {
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
      let checked: {
        response: Awaited<ReturnType<typeof invoke>>;
        batch: ClinicalFillBatchEvidence;
      };
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
