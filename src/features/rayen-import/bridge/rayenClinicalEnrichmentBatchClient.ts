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

export type RayenClinicalEnrichmentField = (typeof RAYEN_CLINICAL_ENRICHMENT_FIELDS)[number];

export interface RayenClinicalEnrichmentTarget {
  bedId: string;
  clinicalEpisodeId: string;
  clinicalCrib?: true;
  fields: Partial<Record<RayenClinicalEnrichmentField, unknown>>;
}

export interface RayenClinicalEnrichmentBatchPayload {
  date: string;
  runId: string;
  mutationId: string;
  expectedLastUpdated: string;
  baseRevision?: number;
  mode: 'shadow' | 'enforced';
  dryRun?: boolean;
  patches: RayenClinicalEnrichmentTarget[];
}

export interface RayenClinicalEnrichmentBatchResponse {
  success: boolean;
  date: string;
  mode: 'shadow' | 'enforced';
  authorityStatus: 'ok' | 'idempotent';
  revision?: number;
  targetCount: number;
  fieldCount: number;
}

export const callRayenClinicalEnrichmentBatch = async (
  payload: RayenClinicalEnrichmentBatchPayload
): Promise<RayenClinicalEnrichmentBatchResponse> => {
  const functions = await defaultFunctionsRuntime.getFunctions();
  const callable = httpsCallable<
    RayenClinicalEnrichmentBatchPayload,
    RayenClinicalEnrichmentBatchResponse
  >(functions, 'applyRayenClinicalEnrichmentBatch');
  const result = await callable(payload);
  return result.data;
};
