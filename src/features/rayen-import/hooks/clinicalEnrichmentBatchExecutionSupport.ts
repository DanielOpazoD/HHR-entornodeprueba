import type {
  ClinicalFillBatchEvidence,
  ClinicalFillPatchOperation,
  ClinicalPersistenceEvidence,
} from '../contracts/clinicalFillContracts';
import {
  callRayenClinicalEnrichmentBatch,
  type RayenClinicalEnrichmentBatchPayload,
} from '../bridge/rayenClinicalEnrichmentBatchClient';
import { clinicalEnrichmentTargetKey } from './clinicalEnrichmentBatchPayload';

const errorCode = (error: unknown): string =>
  String((error as { code?: unknown })?.code || '')
    .trim()
    .toLowerCase();

export const failureMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof (error as { message?: unknown } | null)?.message === 'string'
      ? String((error as { message: string }).message)
      : String(error || 'Causa sin identificar');

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

const isPersistenceScope = (value: unknown): value is ClinicalPersistenceEvidence['scope'] =>
  value === 'current' || value === 'historical';

const safeCount = (value: unknown): number | null => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : null;
};

export const readReportedTransactionRetries = (value: unknown): number | null =>
  safeCount((value as { transactionRetries?: unknown } | null)?.transactionRetries);

export const readServerTransactionRetries = (error: unknown): number | null => {
  const details = (error as { details?: { transactionRetries?: unknown } })?.details;
  return readReportedTransactionRetries(details);
};

export const resolveClinicalPersistenceScope = (
  payload: Pick<RayenClinicalEnrichmentBatchPayload, 'date' | 'authorityDate'>
): ClinicalPersistenceEvidence['scope'] =>
  payload.date === payload.authorityDate ? 'current' : 'historical';

/**
 * A failure that got no answer from the authority: the re-read of the census at the write turn, or a
 * call that failed in the browser before the server replied. Repeating it a moment later can work;
 * a server answer (`functions/…`) or a stale batch would fail again the same way.
 */
export const markClinicalBatchTransportFailure = (error: unknown): unknown => {
  if (errorCode(error).startsWith('functions/')) return error;
  const target = error && typeof error === 'object' ? error : new Error(failureMessage(error));
  Object.assign(target, { clinicalBatchTransportFailure: true });
  return target;
};

export const isClinicalBatchTransportFailure = (error: unknown): boolean =>
  (error as { clinicalBatchTransportFailure?: unknown } | null)?.clinicalBatchTransportFailure ===
  true;

export const withClinicalBatchRetryCount = (error: unknown, clientRetries: number): unknown => {
  const target = error && typeof error === 'object' ? error : new Error(failureMessage(error));
  Object.assign(target, { clinicalBatchRetries: clientRetries });
  return target;
};

export const withPersistenceFailureEvidence = (
  error: unknown,
  evidence: ClinicalPersistenceEvidence
): unknown => {
  const target = error && typeof error === 'object' ? error : new Error(failureMessage(error));
  Object.assign(target, {
    clinicalBatchRetries: evidence.clientRetries,
    clinicalPersistenceEvidence: evidence,
  });
  return target;
};

export const readPersistenceFailureEvidence = (
  error: unknown
): ClinicalPersistenceEvidence | null => {
  const evidence = (error as { clinicalPersistenceEvidence?: Record<string, unknown> })
    ?.clinicalPersistenceEvidence;
  const scope = evidence?.scope;
  const callableAttempts = safeCount(evidence?.callableAttempts);
  const clientRetries = safeCount(evidence?.clientRetries);
  const transactionRetries = safeCount(evidence?.transactionRetries);
  if (
    !isPersistenceScope(scope) ||
    callableAttempts == null ||
    clientRetries == null ||
    transactionRetries == null
  ) {
    return null;
  }
  return { scope, callableAttempts, clientRetries, transactionRetries };
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
  if (parity !== 'matched') {
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

export const operationTargetKey = (operation: ClinicalFillPatchOperation): string =>
  clinicalEnrichmentTargetKey(operation.target);

export const operationLogicalTargetKey = (operation: ClinicalFillPatchOperation): string =>
  `${operation.target.clinicalEpisodeId}|${operation.target.clinicalCrib ? 'crib' : 'patient'}`;

/** After a version conflict the batch keeps only the episodes it was first sent with. */
export const selectRebuiltBatchOperations = (
  rebuiltOperations: ClinicalFillPatchOperation[],
  originalOperations: ClinicalFillPatchOperation[]
): ClinicalFillPatchOperation[] => {
  const expectedKeys = new Set(originalOperations.map(operationLogicalTargetKey));
  const selectedKeys = new Set<string>();
  return rebuiltOperations.filter(operation => {
    const key = operationLogicalTargetKey(operation);
    if (!expectedKeys.has(key)) return false;
    if (selectedKeys.has(key)) {
      throw new Error('La reconstrucción clínica produjo un episodio ambiguo para el fragmento.');
    }
    selectedKeys.add(key);
    return true;
  });
};

/**
 * One operation per bed target, the shape the callable takes: several sources for one bed are
 * merged, and an episode that reaches the batch from two beds is refused before any write.
 */
export const coalesceClinicalBatchOperations = (
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
  const coalesced = [...byTarget.values()];
  const logicalTargets = new Set<string>();
  coalesced.forEach(operation => {
    const key = operationLogicalTargetKey(operation);
    if (logicalTargets.has(key)) {
      throw new Error(
        'El lote clínico contiene el mismo episodio más de una vez para paciente o cuna.'
      );
    }
    logicalTargets.add(key);
  });
  return coalesced;
};
