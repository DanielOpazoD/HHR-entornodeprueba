import type { DailyRecord } from '@/types/domain/dailyRecord';
import type {
  ClinicalFillBatchApplyResult,
  ClinicalFillBatchEvidence,
  ClinicalFillPatchOperation,
} from '../contracts/clinicalFillContracts';
import {
  callRayenClinicalEnrichmentBatch,
  type RayenClinicalEnrichmentBatchPayload,
} from '../bridge/rayenClinicalEnrichmentBatchClient';
import { rebuildClinicalEnrichmentOperations } from '../domain/rebuildClinicalEnrichmentOperations';
import { guardAuthoringSession } from '@/services/storage/authoringSession';
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
  coalesceClinicalBatchOperations,
  isClinicalBatchRetryableError,
  isClinicalBatchVersionConflict,
  markClinicalBatchTransportFailure,
  operationLogicalTargetKey,
  readReportedTransactionRetries,
  readServerTransactionRetries,
  resolveClinicalPersistenceScope,
  selectRebuiltBatchOperations,
  withClinicalBatchRetryCount,
  withPersistenceFailureEvidence,
} from './clinicalEnrichmentBatchExecutionSupport';

const authorityRevision = (record: DailyRecord): unknown =>
  (record as DailyRecord & { meta?: { revision?: unknown } }).meta?.revision;

interface ApplyClinicalEnrichmentBatchInput {
  checkSession?: () => void;
  record: DailyRecord;
  /** Record that owns the synchronization event when the target is the previous census day. */
  authorityDate?: string;
  runId: string;
  operations: ClinicalFillPatchOperation[];
  /** Revalidates original record-derived values at the write turn and after a version conflict. */
  rebuildOperations?: (record: DailyRecord) => ClinicalFillPatchOperation[];
  /** Must read server authority, without merging pending local projections. */
  refreshRecord: () => Promise<DailyRecord>;
  /**
   * Read after a committed batch. Its value is not returned, but the read itself counts: the
   * day's ordinary read admits the server version into this device's copy. Defaults to
   * `refreshRecord`.
   */
  refreshCommittedRecord?: () => Promise<unknown>;
  invoke?: typeof callRayenClinicalEnrichmentBatch;
  createMutationId?: () => string;
}

/** Sends the batch as one authority call, built once from the census read at the write turn. */
export const applyClinicalEnrichmentBatch = async ({
  checkSession,
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
  const session = guardAuthoringSession();
  const check = () => {
    checkSession?.();
    session.check();
  };
  return runExclusiveDailyRecordWrite(
    record.date,
    async () => {
      check();
      // Source reads happen before this turn. Re-read only after earlier writers have settled,
      // and revalidate against the original base before constructing the atomic payload.
      let currentRecord: DailyRecord;
      try {
        currentRecord = await refreshRecord();
      } catch (error) {
        check();
        throw markClinicalBatchTransportFailure(error);
      }
      check();
      if (currentRecord.date !== record.date) {
        throw new Error('La lectura autoritativa corresponde a otra fecha del censo.');
      }
      const versionChanged =
        currentRecord.lastUpdated !== record.lastUpdated ||
        authorityRevision(currentRecord) !== authorityRevision(record);
      if (versionChanged && !rebuildOperations) {
        throw new Error('El censo cambió y el lote clínico debe reconstruirse antes de guardarlo.');
      }
      const currentOperations = coalesceClinicalBatchOperations(
        rebuildOperations ? rebuildOperations(currentRecord) : operations
      );
      const preparePayload = (
        source: DailyRecord,
        batchOperations: ClinicalFillPatchOperation[],
        mutationId: string
      ) =>
        prepareClinicalEnrichmentBatchPayload({
          record: source,
          authorityDate,
          runId,
          operations: batchOperations,
          mutationId,
        });
      let activeRecord = currentRecord;
      let patientWrites = 0;
      let historySnapshots = 0;
      let retries = 0;
      let callableAttempts = 0;
      let transactionRetries = 0;
      let transactionEvidenceComplete = true;
      let activeOperations = currentOperations;
      const mutationId = createMutationId();
      let prepared = preparePayload(activeRecord, activeOperations, mutationId);
      if (!prepared.payload) {
        if (prepared.evidence.requestedFields === 0) {
          return {
            patientWrites: 0,
            historySnapshots: 0,
            batch: summarizeClinicalEnrichmentSections([], []),
          };
        }
        // Over the callable's limit (targets or bytes) nothing is sent: the data stays pending.
        const oneExceedsAlone = currentOperations.some(operation => {
          const single = preparePayload(activeRecord, [operation], mutationId);
          return !single.payload && single.evidence.requestedFields > 0;
        });
        throw new Error(
          oneExceedsAlone
            ? 'Una actualización clínica excede por sí sola el límite transaccional.'
            : 'El lote clínico excede una transacción atómica segura; los datos quedaron pendientes.'
        );
      }

      let activePayload = prepared.payload;
      let checked: {
        response: Awaited<ReturnType<typeof invoke>>;
        batch: ClinicalFillBatchEvidence;
      };
      const invokeEnforced = async (payload: RayenClinicalEnrichmentBatchPayload) => {
        check();
        callableAttempts += 1;
        let response: Awaited<ReturnType<typeof callRayenClinicalEnrichmentBatch>>;
        try {
          response = await invoke(payload);
          check();
        } catch (error) {
          check();
          const reportedRetries = readServerTransactionRetries(error);
          if (reportedRetries == null) transactionEvidenceComplete = false;
          else transactionRetries += reportedRetries;
          throw markClinicalBatchTransportFailure(error);
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
          check();
          if (!isClinicalBatchVersionConflict(error) && !isClinicalBatchRetryableError(error)) {
            throw error;
          }
          retries += 1;
          if (isClinicalBatchVersionConflict(error)) {
            activeRecord = await refreshRecord();
            check();
            if (!rebuildOperations) {
              throw error;
            }
            activeOperations = selectRebuiltBatchOperations(
              rebuildOperations(activeRecord),
              currentOperations
            );
            // A rejected authority check did not consume this identity. Reusing it also preserves
            // idempotency if the first response was lost after a concurrent transaction retry.
            prepared = preparePayload(activeRecord, activeOperations, activePayload.mutationId);
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
              throw new Error(
                'Los datos clínicos quedaron por recalcular con el censo vigente. Vuelve a sincronizar.'
              );
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

      check();
      const response = checked.response;
      const scope = response.targetScope ?? resolveClinicalPersistenceScope(activePayload);
      if (response.authorityStatus === 'ok') {
        patientWrites += response.patientWrites ?? 1;
        historySnapshots += response.historySnapshots ?? Number(activePayload.patches.length > 0);
      }

      try {
        check();
        await refreshCommittedRecord();
        check();
      } catch (error) {
        check();
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
        batch: checked.batch,
      };
    },
    { kind: 'clinical_sync' }
  );
};

type ApplyClinicalFillBatchInput = Omit<
  ApplyClinicalEnrichmentBatchInput,
  'authorityDate' | 'rebuildOperations'
>;

/**
 * The day's clinical fill: at the write turn the batch is rebuilt from the run's base against the
 * census read then. A target whose field changed meanwhile is left out and stays pending; it is
 * not written even if a later rebuild in this attempt would accept it.
 */
export const applyClinicalFillBatch = async (
  input: ApplyClinicalFillBatchInput
): Promise<ClinicalFillBatchApplyResult> => {
  const excluded = new Map<
    string,
    NonNullable<ClinicalFillBatchApplyResult['excludedTargets']>[number]
  >();
  const result = await applyClinicalEnrichmentBatch({
    ...input,
    rebuildOperations: currentRecord =>
      rebuildClinicalEnrichmentOperations({
        baseRecord: input.record,
        currentRecord,
        operations: input.operations,
        onFieldConflict: (operation, error) =>
          excluded.set(operationLogicalTargetKey(operation), { target: operation.target, error }),
      }),
  });
  return excluded.size > 0 ? { ...result, excludedTargets: [...excluded.values()] } : result;
};
