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
import {
  clinicalEnrichmentTargetKey,
  prepareClinicalEnrichmentBatchPayload,
  summarizeClinicalEnrichmentSections,
} from './clinicalEnrichmentBatchPayload';

const errorCode = (error: unknown): string =>
  String((error as { code?: unknown })?.code || '')
    .trim()
    .toLowerCase();

export const isClinicalBatchFallbackError = (error: unknown): boolean => {
  const code = errorCode(error);
  return ['functions/not-found', 'not-found', 'functions/unimplemented', 'unimplemented'].some(
    candidate => code.includes(candidate)
  );
};

const isClinicalBatchRetryableError = (error: unknown): boolean => {
  const code = errorCode(error);
  return [
    'functions/unavailable',
    'unavailable',
    'functions/deadline-exceeded',
    'deadline-exceeded',
    'functions/internal',
    'internal',
    'network-request-failed',
  ].some(candidate => code.includes(candidate));
};

const failureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error || 'Error desconocido');

const withRetryCount = (error: unknown, retries: number): unknown => {
  if (error && typeof error === 'object') {
    Object.assign(error, { clinicalBatchRetries: retries });
    return error;
  }
  return Object.assign(new Error(failureMessage(error)), { clinicalBatchRetries: retries });
};

const assertCommittedResponse = (
  response: Awaited<ReturnType<typeof callRayenClinicalEnrichmentBatch>>,
  payload: RayenClinicalEnrichmentBatchPayload
): ClinicalFillBatchEvidence => {
  if (
    response?.success !== true ||
    response.date !== payload.date ||
    response.mode !== payload.mode ||
    !['ok', 'idempotent'].includes(response.authorityStatus)
  ) {
    throw new Error('El backend devolvió una confirmación inválida para el lote clínico.');
  }
  const requestedTargetKeys = new Set([
    ...payload.patches.map(clinicalEnrichmentTargetKey),
    ...(payload.checkpoints ?? []).map(clinicalEnrichmentTargetKey),
  ]);
  const requestedFields =
    payload.patches.reduce((total, patch) => total + Object.keys(patch.fields).length, 0) +
    (payload.checkpoints?.length ?? 0);
  const checkpointKeys = new Set((payload.checkpoints ?? []).map(clinicalEnrichmentTargetKey));
  const clinicalKeys = new Set(payload.patches.map(clinicalEnrichmentTargetKey));
  const checkpointOnlyTargets = [...checkpointKeys].filter(key => !clinicalKeys.has(key)).length;
  const countsMatch =
    response.targetCount === requestedTargetKeys.size && response.fieldCount === requestedFields;
  const parity =
    response.resultParity == null
      ? 'unavailable'
      : countsMatch && response.resultParity === 'matched'
        ? 'matched'
        : 'mismatch';
  // Accept only exact pre-parity confirmations during rolling deploys; mismatches fail closed.
  const legacyCommittedResponse = response.resultParity == null && countsMatch;
  if (payload.mode === 'enforced' && parity !== 'matched' && !legacyCommittedResponse) {
    throw new Error('El backend no confirmó paridad para el lote clínico aplicado.');
  }
  return {
    mode: payload.mode,
    parity,
    clinicalTargets: clinicalKeys.size,
    checkpointTargets: checkpointKeys.size,
    checkpointOnlyTargets,
    requestedFields,
    backendTargets: response.targetCount,
    backendFields: response.fieldCount,
  };
};

const applyLegacyOperations = async (
  operations: ClinicalFillPatchOperation[],
  applyPatch: (operation: ClinicalFillPatchOperation) => Promise<void>
): Promise<ClinicalFillBatchApplyResult> => {
  const failures: NonNullable<ClinicalFillBatchApplyResult['failures']> = [];
  let patientWrites = 0;
  let historySnapshots = 0;
  for (const [index, operation] of operations.entries()) {
    try {
      const clinicalChange = (operation.clinicalFieldCount ?? 1) > 0;
      const captureHistorySnapshot = clinicalChange && historySnapshots === 0;
      await applyPatch({
        patch: operation.patch,
        target: {
          ...operation.target,
          captureHistorySnapshot,
        },
      });
      patientWrites += 1;
      if (captureHistorySnapshot) historySnapshots = 1;
    } catch (error) {
      failures.push({ index, message: failureMessage(error) });
    }
  }
  return {
    patientWrites,
    historySnapshots,
    ...(failures.length > 0 ? { failures } : {}),
  };
};

interface ApplyClinicalEnrichmentBatchInput {
  mode: ClinicalEnrichmentBatchMode;
  record: DailyRecord;
  runId: string;
  operations: ClinicalFillPatchOperation[];
  applyPatch: (operation: ClinicalFillPatchOperation) => Promise<void>;
  refreshRecord: () => Promise<DailyRecord>;
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
  const { payload, evidence } = prepareClinicalEnrichmentBatchPayload({
    mode: 'shadow',
    record,
    runId,
    operations,
    mutationId: createMutationId(),
  });
  if (!payload) {
    return evidence;
  }
  const response = await invoke(payload);
  return assertCommittedResponse(response, payload);
};

/** Executes one bounded authority call, preserving the established writes as a safe fallback. */
export const applyClinicalEnrichmentBatch = async ({
  mode,
  record,
  runId,
  operations,
  applyPatch,
  refreshRecord,
  invoke = callRayenClinicalEnrichmentBatch,
  createMutationId = createSyncMutationId,
}: ApplyClinicalEnrichmentBatchInput): Promise<ClinicalFillBatchApplyResult> => {
  if (mode === 'off') {
    return applyLegacyOperations(operations, applyPatch);
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
    const legacy = await applyLegacyOperations(operations, applyPatch);
    let shadowRecord: DailyRecord;
    try {
      shadowRecord = await refreshRecord();
    } catch (error) {
      console.warn('[rayen-import] validación shadow sin censo post-escritura:', errorCode(error));
      const { evidence } = prepareClinicalEnrichmentBatchPayload({
        mode,
        record,
        runId,
        operations,
        mutationId: createMutationId(),
      });
      return { ...legacy, batch: evidence };
    }
    const { payload: shadowPayload, evidence } = prepareClinicalEnrichmentBatchPayload({
      mode,
      record: shadowRecord,
      runId,
      operations,
      mutationId: createMutationId(),
    });
    if (!shadowPayload) return { ...legacy, batch: evidence };
    const batch = await invokeChecked(shadowPayload)
      .then(result => result.batch)
      .catch(error => {
        console.warn(
          '[rayen-import] validación shadow del lote clínico no disponible:',
          errorCode(error)
        );
        return summarizeClinicalEnrichmentSections(
          shadowPayload.patches,
          shadowPayload.checkpoints ?? [],
          'shadow'
        );
      });
    return { ...legacy, batch };
  }

  const { payload, evidence } = prepareClinicalEnrichmentBatchPayload({
    mode,
    record,
    runId,
    operations,
    mutationId: createMutationId(),
  });
  if (!payload) {
    return applyLegacyOperations(operations, applyPatch);
  }

  let retries = 0;
  try {
    let checked: Awaited<ReturnType<typeof invokeChecked>>;
    try {
      checked = await invokeChecked(payload);
    } catch (error) {
      if (!isClinicalBatchRetryableError(error)) throw error;
      retries = 1;
      checked = await invokeChecked(payload);
    }
    try {
      await refreshRecord();
    } catch (error) {
      console.warn('[rayen-import] lote aplicado; hidratación local diferida:', errorCode(error));
    }
    const response = checked.response;
    const committed = response.authorityStatus === 'ok';
    return {
      patientWrites: committed ? (response.patientWrites ?? 1) : 0,
      historySnapshots: committed
        ? (response.historySnapshots ?? Number(payload.patches.length > 0))
        : 0,
      retries,
      batch: checked.batch,
    };
  } catch (error) {
    if (retries > 0) throw withRetryCount(error, retries);
    if (!isClinicalBatchFallbackError(error)) throw error;
    const result = await applyLegacyOperations(operations, applyPatch);
    return {
      ...result,
      retries: retries + 1,
      batch: { ...evidence, mode: 'enforced' },
    };
  }
};
