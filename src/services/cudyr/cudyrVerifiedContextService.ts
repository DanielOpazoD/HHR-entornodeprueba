import { supplementMonths } from './cudyrSupplementService';
import { callCudyrFunction } from './cudyrFunctionsCall';
import type { CudyrVerifiedContext } from './cudyrVerifiedContext';
import {
  guardAuthoringSession,
  type AuthoringSessionGuard,
} from '@/services/storage/authoringSession';
export const loadCudyrVerifiedContexts = async (from: string, to: string, signal: AbortSignal) => {
  const guard = guardAuthoringSession({ signal });
  const result: CudyrVerifiedContext[] = [];
  for (const month of supplementMonths(from, to)) {
    const { review } = await callCudyrFunction<{ review: CudyrVerifiedContext | null }>(
      'readCudyrHistory',
      { kind: 'verified-context', month },
      guard
    );
    if (review) result.push(review);
  }
  return result;
};
/** Explicit approval by the responsible reviewer; no CUDYR score or original census is written. */
export const approveCudyrReconstructedCensus = (
  request: {
    month: string;
    expectedRevision: number;
    operationId: string;
    reason: string;
    days: Array<{ date: string; fingerprint: string }>;
  },
  guard: AuthoringSessionGuard
) =>
  callCudyrFunction<{ persisted: boolean; revision: number }>(
    'archiveCudyrHistory',
    {
      ...request,
      kind: 'save-verified-context',
      action: 'approve_census',
      policyVersion: 2,
      schemaVersion: 1,
      confirmed: true,
    },
    guard
  );
