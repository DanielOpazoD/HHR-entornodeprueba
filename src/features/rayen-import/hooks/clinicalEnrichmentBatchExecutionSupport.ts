import type { DailyRecord } from '../contracts/rayenDomainContracts';
import type {
  ClinicalFillBatchEvidence,
  ClinicalFillPatchOperation,
} from '../contracts/clinicalFillContracts';
import {
  callRayenClinicalEnrichmentBatch,
  type RayenClinicalEnrichmentBatchPayload,
} from '../bridge/rayenClinicalEnrichmentBatchClient';
import type { ClinicalEnrichmentBatchMode } from '../domain/clinicalEnrichmentBatchMode';
import {
  clinicalEnrichmentTargetKey,
  prepareClinicalEnrichmentBatchPayload,
} from './clinicalEnrichmentBatchPayload';

const errorCode = (error: unknown): string =>
  String((error as { code?: unknown })?.code || '')
    .trim()
    .toLowerCase();

export const failureMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof (error as { message?: unknown } | null)?.message === 'string'
      ? String((error as { message: string }).message)
      : String(error || 'Error desconocido');

export const isClinicalBatchRetryableError = (error: unknown): boolean => {
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

export const isClinicalBatchVersionConflict = (error: unknown): boolean => {
  const code = errorCode(error);
  const message = failureMessage(error).toLowerCase();
  return (
    code.includes('aborted') &&
    (message.includes('revision_mismatch') || message.includes('version_mismatch'))
  );
};

export const withRetryCount = (error: unknown, retries: number): unknown => {
  if (error && typeof error === 'object') {
    Object.assign(error, { clinicalBatchRetries: retries });
    return error;
  }
  return Object.assign(new Error(failureMessage(error)), { clinicalBatchRetries: retries });
};

export const assertCommittedResponse = (
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
    response.authorityStatus === 'idempotent' && countsMatch
      ? 'matched'
      : response.resultParity == null
        ? 'unavailable'
        : countsMatch && response.resultParity === 'matched'
          ? 'matched'
          : 'mismatch';
  if (payload.mode === 'enforced' && parity !== 'matched') {
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

export interface BoundedClinicalBatchChunk {
  operations: ClinicalFillPatchOperation[];
  mutationId: string;
}

export const operationTargetKey = (operation: ClinicalFillPatchOperation): string =>
  clinicalEnrichmentTargetKey(operation.target);

export const operationLogicalTargetKey = (operation: ClinicalFillPatchOperation): string =>
  `${operation.target.clinicalEpisodeId}|${operation.target.clinicalCrib ? 'crib' : 'patient'}`;

const coalesceOperationsByTarget = (
  operations: ClinicalFillPatchOperation[]
): ClinicalFillPatchOperation[] => {
  const byTarget = new Map<string, ClinicalFillPatchOperation>();
  operations.forEach(operation => {
    const key = operationTargetKey(operation);
    const previous = byTarget.get(key);
    if (!previous) {
      byTarget.set(key, operation);
      return;
    }
    if (previous.target.clinicalEpisodeId !== operation.target.clinicalEpisodeId) {
      throw new Error('El lote clínico mezcla episodios distintos para una misma cama.');
    }
    byTarget.set(key, {
      target: previous.target,
      patch: { ...previous.patch, ...operation.patch },
      ...(previous.clinicalFieldCount !== undefined || operation.clinicalFieldCount !== undefined
        ? {
            clinicalFieldCount:
              (previous.clinicalFieldCount ?? 0) + (operation.clinicalFieldCount ?? 0),
          }
        : {}),
      checkpointChanged: previous.checkpointChanged || operation.checkpointChanged,
    });
  });
  return [...byTarget.values()];
};

export const mergeBatchEvidence = (
  items: ClinicalFillBatchEvidence[],
  mode: ClinicalFillBatchEvidence['mode']
): ClinicalFillBatchEvidence => {
  const parity = items.some(item => item.parity === 'mismatch')
    ? 'mismatch'
    : items.length > 0 && items.every(item => item.parity === 'matched')
      ? 'matched'
      : 'unavailable';
  const backendTargets = items.every(item => item.backendTargets !== undefined)
    ? items.reduce((total, item) => total + (item.backendTargets ?? 0), 0)
    : undefined;
  const backendFields = items.every(item => item.backendFields !== undefined)
    ? items.reduce((total, item) => total + (item.backendFields ?? 0), 0)
    : undefined;
  return {
    mode,
    parity,
    clinicalTargets: items.reduce((total, item) => total + item.clinicalTargets, 0),
    checkpointTargets: items.reduce((total, item) => total + item.checkpointTargets, 0),
    checkpointOnlyTargets: items.reduce((total, item) => total + item.checkpointOnlyTargets, 0),
    requestedFields: items.reduce((total, item) => total + item.requestedFields, 0),
    ...(backendTargets !== undefined ? { backendTargets } : {}),
    ...(backendFields !== undefined ? { backendFields } : {}),
  };
};

export const buildBoundedClinicalBatchChunks = ({
  mode,
  record,
  authorityDate,
  runId,
  operations,
  createMutationId,
}: {
  mode: Exclude<ClinicalEnrichmentBatchMode, 'off'>;
  record: DailyRecord;
  authorityDate?: string;
  runId: string;
  operations: ClinicalFillPatchOperation[];
  createMutationId: () => string;
}): BoundedClinicalBatchChunk[] => {
  const chunks: BoundedClinicalBatchChunk[] = [];
  const usedMutationIds = new Set<string>();
  let mutationSequence = 0;
  const allocateMutationId = (): string => {
    const generated = createMutationId();
    if (!usedMutationIds.has(generated)) {
      usedMutationIds.add(generated);
      return generated;
    }
    mutationSequence += 1;
    const suffix = `-part-${mutationSequence + 1}`;
    const unique = `${generated.slice(0, Math.max(1, 160 - suffix.length))}${suffix}`;
    usedMutationIds.add(unique);
    return unique;
  };

  const coalescedOperations = coalesceOperationsByTarget(operations);
  const logicalTargets = new Set<string>();
  coalescedOperations.forEach(operation => {
    const key = operationLogicalTargetKey(operation);
    if (logicalTargets.has(key)) {
      throw new Error(
        'El lote clínico contiene el mismo episodio más de una vez para paciente o cuna.'
      );
    }
    logicalTargets.add(key);
  });

  let currentOperations: ClinicalFillPatchOperation[] = [];
  let currentMutationId = allocateMutationId();
  for (const operation of coalescedOperations) {
    const candidateOperations = [...currentOperations, operation];
    const candidate = prepareClinicalEnrichmentBatchPayload({
      mode,
      record,
      authorityDate,
      runId,
      operations: candidateOperations,
      mutationId: currentMutationId,
    });
    if (candidate.payload) {
      currentOperations = candidateOperations;
      continue;
    }
    if (currentOperations.length > 0) {
      chunks.push({ operations: currentOperations, mutationId: currentMutationId });
      currentOperations = [operation];
      currentMutationId = allocateMutationId();
      const single = prepareClinicalEnrichmentBatchPayload({
        mode,
        record,
        authorityDate,
        runId,
        operations: currentOperations,
        mutationId: currentMutationId,
      });
      if (single.payload) continue;
      if (single.evidence.requestedFields === 0) {
        currentOperations = [];
        continue;
      }
      throw new Error('Una actualización clínica excede por sí sola el límite transaccional.');
    }
    if (candidate.evidence.requestedFields > 0) {
      throw new Error('Una actualización clínica excede por sí sola el límite transaccional.');
    }
  }
  if (currentOperations.length > 0) {
    chunks.push({ operations: currentOperations, mutationId: currentMutationId });
  }
  return chunks;
};
