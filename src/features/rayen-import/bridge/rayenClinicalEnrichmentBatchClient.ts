import type { RayenOwnedClinicalField as RayenClinicalEnrichmentField } from '@/types/domain/rayenClinicalFields';
import { guardAuthoringSession } from '@/services/session/authoringSession';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { withClientRuntimeContractVersion } from '@/services/storage/clinicalAuthorityClientVersion';
import { RAYEN_OWNED_CLINICAL_FIELDS } from '@/types/domain/rayenClinicalFields';

export const RAYEN_CLINICAL_ENRICHMENT_FIELDS = RAYEN_OWNED_CLINICAL_FIELDS;

export const RAYEN_CLINICAL_ENRICHMENT_MAX_BATCH_BYTES = 500_000;
export const RAYEN_CLINICAL_ENRICHMENT_MAX_TARGETS = 32;
export const RAYEN_CLINICAL_ENRICHMENT_TIMEOUT_MS = 20_000;
export const RAYEN_CLINICAL_ENRICHMENT_FIELD_CONTRACT_VERSION = 2 as const;

export const RAYEN_DOCUMENTARY_CUDYR_FIELD_CONTRACT_VERSION = 3 as const;

export interface RayenClinicalEnrichmentTarget {
  bedId: string;
  clinicalEpisodeId: string;
  clinicalCrib?: true;
  fields: Partial<Record<RayenClinicalEnrichmentField, unknown>>;
}

export interface RayenClinicalCheckpointTarget {
  bedId: string;
  clinicalEpisodeId: string;
  clinicalCrib?: true;
  checkpoint: unknown;
}

export interface RayenClinicalEnrichmentBatchPayload {
  date: string;
  /** Daily record that contains the server-confirmed synchronization event. */
  authorityDate: string;
  runId: string;
  mutationId: string;
  expectedLastUpdated: string;
  baseRevision?: number;
  fieldContractVersion:
    | typeof RAYEN_CLINICAL_ENRICHMENT_FIELD_CONTRACT_VERSION
    | typeof RAYEN_DOCUMENTARY_CUDYR_FIELD_CONTRACT_VERSION;
  mode: 'enforced';
  patches: RayenClinicalEnrichmentTarget[];
  checkpoints?: RayenClinicalCheckpointTarget[];
}

export interface RayenClinicalEnrichmentBatchResponse {
  success: boolean;
  date: string;
  mode: 'enforced';
  authorityStatus: 'ok' | 'idempotent';
  revision?: number;
  targetCount: number;
  fieldCount: number;
  clinicalTargetCount?: number;
  checkpointTargetCount?: number;
  checkpointOnlyTargetCount?: number;
  resultParity?: 'matched' | 'mismatch';
  patientWrites?: number;
  historySnapshots?: number;
  targetScope?: 'current' | 'historical';
  transactionAttempts?: number;
  transactionRetries?: number;
  /** Optional numeric server phases. Older deployed callables omit these measurements. */
  serverTimingsMs?: {
    authorizationMs?: number;
    transactionMs?: number;
    telemetryMs?: number;
    handlerMs?: number;
  };
  /** Aggregate across transaction attempts. No clinical fields or document identifiers. */
  transactionTimingsMs?: {
    callbackMs: number;
    documentReadMs: number;
    specialtyAuditMs: number;
    otherCallbackMs: number;
    outsideCallbackMs: number;
  };
}

const CALLABLE_REGION = 'southamerica-east1';
const CALLABLE_NAME = 'applyRayenClinicalEnrichmentBatch';

export const callRayenClinicalEnrichmentBatch = async (
  payload: RayenClinicalEnrichmentBatchPayload
): Promise<RayenClinicalEnrichmentBatchResponse> => {
  const { check } = guardAuthoringSession();
  const functions = await defaultFunctionsRuntime.getRegionalFunctions(CALLABLE_REGION);
  check();
  const { httpsCallable } = await import('firebase/functions');
  check();
  const callable = httpsCallable<
    RayenClinicalEnrichmentBatchPayload,
    RayenClinicalEnrichmentBatchResponse
  >(functions, CALLABLE_NAME, {
    timeout: RAYEN_CLINICAL_ENRICHMENT_TIMEOUT_MS,
  });
  const result = await callable(withClientRuntimeContractVersion(payload));
  check();
  return result.data;
};

/**
 * Starts the callable's server instance and opens its Firestore connection when a synchronization
 * begins, so the clinical save at its end pays neither. Production: the first call of a run took
 * ~3.7 s more than a later one (W12-PERF3); a bare preflight removed the instance start but left
 * ~1.1 s of connection start in the save's first authorization (W17-PERF4).
 *
 * The warm-up is the callable itself with `{ warmup: true }`: the server only authorizes the
 * signed-in caller (the role read opens the connection) and answers. No patient data is sent, read
 * or written. A failed warm-up costs only the start the save already pays, so it is ignored.
 */
export const warmRayenClinicalEnrichmentBatch = async (): Promise<void> => {
  try {
    const functions = await defaultFunctionsRuntime.getRegionalFunctions(CALLABLE_REGION);
    const { httpsCallable } = await import('firebase/functions');
    await httpsCallable<{ warmup: true }, unknown>(functions, CALLABLE_NAME, {
      timeout: RAYEN_CLINICAL_ENRICHMENT_TIMEOUT_MS,
    })({ warmup: true });
  } catch {
    // Expected when signed out, offline or on a server without the warm-up; the save is unaffected.
  }
};
