import type { RayenSyncExecutionState } from './rayenSyncExecutionState';
import { useLayoutEffect, useRef } from 'react';
import type { AuthoringSessionGuard } from '@/services/storage/authoringSession';
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
  session: AuthoringSessionGuard,
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
  const { generation } = session.session;
  if (result.status !== 'complete' || !isAuthorized() || !generation || !session.isCurrent())
    return;
  try {
    const { recoverPolicyBlockedCudyrArchives } =
      await import('@/services/storage/sync/publicCudyrPolicyRecovery');
    if (!isAuthorized() || !session.isCurrent()) return;
    await recoverPolicyBlockedCudyrArchives(true, generation, isAuthorized);
  } catch {
    // A recovery chunk failure cannot undo an already confirmed clinical stage. The archives stay
    // in the durable queue and the next complete sync releases them, so nobody has to act.
    recordOperationalTelemetry({
      category: 'sync',
      operation: 'cudyr_archive_recovery_unavailable',
      status: 'degraded',
      runtimeState: 'recoverable',
      issues: ['El archivo CUDYR sigue pendiente.'],
    });
  }
};
