import { httpsCallable } from 'firebase/functions';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';

export const RAYEN_CLINICAL_ENRICHMENT_FIELDS = [
  'devices',
  'deviceDetails',
  'deviceInstanceHistory',
  'evaluationScores',
  'vitalSigns',
  'vitalSignsHistory',
  'clinicalSyncCheckpoint',
] as const;

export const RAYEN_CLINICAL_ENRICHMENT_MAX_BATCH_BYTES = 500_000;
export const RAYEN_CLINICAL_ENRICHMENT_MAX_TARGETS = 32;
export const RAYEN_CLINICAL_ENRICHMENT_TIMEOUT_MS = 20_000;
export const RAYEN_CLINICAL_ENRICHMENT_FIELD_CONTRACT_VERSION = 2 as const;

export type RayenClinicalEnrichmentField = (typeof RAYEN_CLINICAL_ENRICHMENT_FIELDS)[number];

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
  runId: string;
  mutationId: string;
  expectedLastUpdated: string;
  baseRevision?: number;
  fieldContractVersion: typeof RAYEN_CLINICAL_ENRICHMENT_FIELD_CONTRACT_VERSION;
  mode: 'shadow' | 'enforced';
  dryRun?: boolean;
  patches: RayenClinicalEnrichmentTarget[];
  checkpoints?: RayenClinicalCheckpointTarget[];
}

export interface RayenClinicalEnrichmentBatchResponse {
  success: boolean;
  date: string;
  mode: 'shadow' | 'enforced';
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
}

export const callRayenClinicalEnrichmentBatch = async (
  payload: RayenClinicalEnrichmentBatchPayload
): Promise<RayenClinicalEnrichmentBatchResponse> => {
  const functions = await defaultFunctionsRuntime.getFunctions();
  const callable = httpsCallable<
    RayenClinicalEnrichmentBatchPayload,
    RayenClinicalEnrichmentBatchResponse
  >(functions, 'applyRayenClinicalEnrichmentBatch', {
    timeout: RAYEN_CLINICAL_ENRICHMENT_TIMEOUT_MS,
  });
  const result = await callable(payload);
  return result.data;
};
