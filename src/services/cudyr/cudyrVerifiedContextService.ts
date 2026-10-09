import { callCudyrArchive, supplementMonths } from './cudyrSupplementService';
import type { CudyrVerifiedContext, CudyrVerifiedContextEntry } from './cudyrVerifiedContext';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';
export const loadCudyrVerifiedContexts = async (from: string, to: string, signal: AbortSignal) => {
  const owner = getStoredSessionOwnerKey(),
    generation = getSessionGeneration();
  const result: CudyrVerifiedContext[] = [];
  for (const month of supplementMonths(from, to)) {
    signal.throwIfAborted();
    const { review } = await callCudyrArchive<{
      review: CudyrVerifiedContext | null;
    }>('readCudyrHistory', { kind: 'verified-context', month });
    signal.throwIfAborted();
    if (owner !== getStoredSessionOwnerKey() || generation !== getSessionGeneration())
      throw new Error('La sesión cambió.');
    if (review) result.push(review);
  }
  return result;
};
export const saveCudyrVerifiedContext = (request: {
  month: string;
  action: 'replace' | 'withdraw';
  reason: string;
  expectedRevision: number;
  operationId: string;
  entries: CudyrVerifiedContextEntry[];
  reconstructedDays?: CudyrVerifiedContext['reconstructedDays'];
  files: Array<{ name: string; base64: string }>;
}) =>
  callCudyrArchive<{ persisted: boolean; revision: number }>('archiveCudyrHistory', {
    ...request,
    kind: 'save-verified-context',
    schemaVersion: 1,
    confirmed: true,
  });

/** Explicit approval by the responsible reviewer; no CUDYR score or original census is written. */
export const approveCudyrReconstructedCensus = (request: {
  month: string;
  expectedRevision: number;
  operationId: string;
  reason: string;
  days: Array<{ date: string; fingerprint: string }>;
}) =>
  callCudyrArchive<{ persisted: boolean; revision: number }>('archiveCudyrHistory', {
    ...request,
    kind: 'save-verified-context',
    action: 'approve_census',
    policyVersion: 2,
    schemaVersion: 1,
    confirmed: true,
  });
