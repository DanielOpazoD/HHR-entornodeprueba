import type { RayenSyncExecutionState } from './rayenSyncExecutionState';
import { useLayoutEffect, useRef } from 'react';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import {
  isClinicalRetryToken,
  type ClinicalFillRequest,
  type ClinicalStageResult,
} from '../contracts/clinicalStageResult';
import { isConfirmedRayenCensusHandoff } from './rayenCensusPersistenceGuard';
import type { RayenImportPolicy } from '../settings/rayenImportSettings';
import type { RayenImportPolicyStatus } from './useRayenImportMode';

export const clinicalFillRequestRunId = (request: ClinicalFillRequest): string | undefined => {
  const source = isClinicalRetryToken(request) ? request.source : request;
  return isConfirmedRayenCensusHandoff(source) ? source.runId : source.rayenSync?.runId;
};

export const isCurrentRayenClinicalRun = (
  state: RayenSyncExecutionState,
  runId?: string
): boolean =>
  Boolean(runId) &&
  state.stage?.type === 'syncing_clinical' &&
  (state.context?.runId ?? state.pending?.runId) === runId;

export const useCurrentRayenRecoveryPolicy = (
  policy: RayenImportPolicy,
  status: RayenImportPolicyStatus
) => {
  const ref = useRef({ status, policy });
  useLayoutEffect(() => {
    ref.current = { status, policy };
  }, [status, policy]);
  return ref;
};

export const recoverCudyrArchivesAfterClinicalSync = async (
  result: ClinicalStageResult,
  readPolicy: () => { status: RayenImportPolicyStatus; policy: RayenImportPolicy },
  expectedRevision: number,
  generation: string | null,
  isCurrentRun: () => boolean = () => true
): Promise<void> => {
  const isAuthorized = () => {
    const current = readPolicy();
    return (
      isCurrentRun() &&
      current.status === 'ready' &&
      current.policy.clinicalBatchMode === 'enforced' &&
      current.policy.revision === expectedRevision
    );
  };
  if (
    result.status !== 'complete' ||
    !isAuthorized() ||
    !generation ||
    generation !== getSessionGeneration()
  )
    return;
  try {
    const { recoverPolicyBlockedCudyrArchives } =
      await import('@/services/storage/sync/publicCudyrPolicyRecovery');
    if (!isAuthorized() || generation !== getSessionGeneration()) return;
    await recoverPolicyBlockedCudyrArchives(true, generation, isAuthorized);
  } catch {
    // A recovery chunk failure cannot undo an already confirmed clinical stage.
    recordOperationalTelemetry({
      category: 'sync',
      operation: 'cudyr_archive_recovery_unavailable',
      status: 'failed',
      issues: ['El archivo CUDYR sigue pendiente.'],
    });
  }
};
