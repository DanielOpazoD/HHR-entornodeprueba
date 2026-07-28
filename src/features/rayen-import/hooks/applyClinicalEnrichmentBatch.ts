import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type {
  ClinicalFillBatchApplyResult,
  ClinicalFillPatchOperation,
} from '../contracts/clinicalFillContracts';
import {
  callRayenClinicalEnrichmentBatch,
  RAYEN_CLINICAL_ENRICHMENT_FIELDS,
  RAYEN_CLINICAL_ENRICHMENT_MAX_BATCH_BYTES,
  type RayenClinicalEnrichmentBatchPayload,
  type RayenClinicalEnrichmentTarget,
} from '../bridge/rayenClinicalEnrichmentBatchClient';
import type { ClinicalEnrichmentBatchMode } from '../domain/clinicalEnrichmentBatchMode';
import { createSyncMutationId } from '@/services/storage/sync/syncMutationIdentity';

const allowedFields = new Set<string>(RAYEN_CLINICAL_ENRICHMENT_FIELDS);

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

const serializedBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

const assertCommittedResponse = (
  response: Awaited<ReturnType<typeof callRayenClinicalEnrichmentBatch>>,
  payload: RayenClinicalEnrichmentBatchPayload
): void => {
  if (
    response?.success !== true ||
    response.date !== payload.date ||
    response.mode !== payload.mode ||
    response.targetCount !== payload.patches.length ||
    !['ok', 'idempotent'].includes(response.authorityStatus)
  ) {
    throw new Error('El backend devolvió una confirmación inválida para el lote clínico.');
  }
};

const toCallableTarget = (operation: ClinicalFillPatchOperation): RayenClinicalEnrichmentTarget => {
  const { target, patch } = operation;
  const prefix = `beds.${target.bedId}${target.clinicalCrib ? '.clinicalCrib' : ''}.`;
  const fields: RayenClinicalEnrichmentTarget['fields'] = {};
  Object.entries(patch).forEach(([path, value]) => {
    if (!path.startsWith(prefix)) {
      throw new Error('El lote clínico contiene una ruta fuera del paciente esperado.');
    }
    const field = path.slice(prefix.length);
    if (!allowedFields.has(field) || field.includes('.')) {
      throw new Error('El lote clínico contiene un campo no autorizado.');
    }
    fields[field as keyof typeof fields] = value === undefined ? null : value;
  });
  if (Object.keys(fields).length === 0) {
    throw new Error('El lote clínico no contiene campos para persistir.');
  }
  return {
    bedId: target.bedId,
    clinicalEpisodeId: target.clinicalEpisodeId,
    ...(target.clinicalCrib ? { clinicalCrib: true as const } : {}),
    fields,
  };
};

const resolveBaseRevision = (record: DailyRecord): number | undefined => {
  const revision = Number(
    (record as DailyRecord & { meta?: { revision?: unknown } }).meta?.revision
  );
  return Number.isFinite(revision) && revision >= 0 ? revision : undefined;
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
      await applyPatch({
        patch: operation.patch,
        target: {
          ...operation.target,
          captureHistorySnapshot: historySnapshots === 0,
        },
      });
      patientWrites += 1;
      if (historySnapshots === 0) historySnapshots = 1;
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
  refreshRecord: () => Promise<unknown>;
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

const preparePayload = ({
  mode,
  record,
  runId,
  operations,
  createMutationId,
}: Pick<ApplyClinicalEnrichmentBatchInput, 'mode' | 'record' | 'runId' | 'operations'> & {
  createMutationId: () => string;
}): RayenClinicalEnrichmentBatchPayload | null => {
  if (operations.length === 0 || operations.length > 32) return null;
  const patches = operations.map(toCallableTarget);
  if (serializedBytes(patches) > RAYEN_CLINICAL_ENRICHMENT_MAX_BATCH_BYTES) return null;
  return {
    date: record.date,
    runId,
    mutationId: createMutationId(),
    expectedLastUpdated: record.lastUpdated,
    baseRevision: resolveBaseRevision(record),
    mode: mode === 'shadow' ? 'shadow' : 'enforced',
    dryRun: mode === 'shadow',
    patches,
  };
};

export const observeClinicalEnrichmentBatch = async ({
  record,
  runId,
  operations,
  invoke = callRayenClinicalEnrichmentBatch,
  createMutationId = createSyncMutationId,
}: ObserveClinicalEnrichmentBatchInput): Promise<void> => {
  const payload = preparePayload({
    mode: 'shadow',
    record,
    runId,
    operations,
    createMutationId,
  });
  if (!payload) return;
  const response = await invoke(payload);
  assertCommittedResponse(response, payload);
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
  const payload = preparePayload({ mode, record, runId, operations, createMutationId });
  if (!payload) {
    return applyLegacyOperations(operations, applyPatch);
  }
  const invokeChecked = async (): Promise<
    Awaited<ReturnType<typeof callRayenClinicalEnrichmentBatch>>
  > => {
    const response = await invoke(payload);
    assertCommittedResponse(response, payload);
    return response;
  };

  if (mode === 'shadow') {
    const legacy = applyLegacyOperations(operations, applyPatch);
    await invokeChecked().catch(error => {
      console.warn(
        '[rayen-import] validación shadow del lote clínico no disponible:',
        errorCode(error)
      );
    });
    return legacy;
  }

  let retries = 0;
  try {
    let response: Awaited<ReturnType<typeof callRayenClinicalEnrichmentBatch>>;
    try {
      response = await invokeChecked();
    } catch (error) {
      if (!isClinicalBatchRetryableError(error)) throw error;
      retries = 1;
      response = await invokeChecked();
    }
    try {
      await refreshRecord();
    } catch (error) {
      console.warn('[rayen-import] lote aplicado; hidratación local diferida:', errorCode(error));
    }
    const committed = response.authorityStatus === 'ok';
    return {
      patientWrites: committed ? 1 : 0,
      historySnapshots: committed ? 1 : 0,
      retries,
    };
  } catch (error) {
    if (retries > 0) throw withRetryCount(error, retries);
    if (!isClinicalBatchFallbackError(error)) throw error;
    const result = await applyLegacyOperations(operations, applyPatch);
    return { ...result, retries: retries + 1 };
  }
};
