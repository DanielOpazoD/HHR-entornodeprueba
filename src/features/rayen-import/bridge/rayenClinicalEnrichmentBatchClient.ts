import type { RayenOwnedClinicalField as RayenClinicalEnrichmentField } from '@/types/domain/rayenClinicalFields';
import { guardAuthoringSession } from '@/services/storage/authoringSession';
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
 * Starts the callable's server instance when a synchronization begins, so the clinical save at its
 * end does not wait for a cold start. Production, 08–15 Nov: the first call of a run took ~3.7 s
 * more than a second call of the same run. The function is called a few times a day, so it is
 * almost always cold.
 *
 * Only a CORS preflight reaches the server: the function answers it without running its handler,
 * so nothing is read, written or logged, and no credential or patient data is sent. The browser then
 * refuses the OPTIONS request itself; that refusal is the expected outcome and is ignored. A failed
 * warm-up costs only the cold start the save already pays today.
 */
export const warmRayenClinicalEnrichmentBatch = async (): Promise<void> => {
  try {
    const functions = await defaultFunctionsRuntime.getRegionalFunctions(CALLABLE_REGION);
    // The SDK's own resolver, so the emulator and the deployed region use the same address.
    const url = (functions as Partial<{ _url: (name: string) => string }>)._url?.(CALLABLE_NAME);
    if (url) await fetch(url, { method: 'OPTIONS' });
  } catch {
    // Expected: the browser rejects the OPTIONS request after the preflight booted the instance.
  }
};
