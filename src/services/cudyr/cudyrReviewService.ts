import { httpsCallable } from 'firebase/functions';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';
import type {
  CudyrReviewDecision,
  CudyrReviewEvidence,
  SavedCudyrReview,
} from '@/types/domain/cudyrReview';

const call = async <T>(endpoint: string, request: unknown, signal: AbortSignal): Promise<T> => {
  const generation = getSessionGeneration(),
    owner = getStoredSessionOwnerKey();
  const check = () => {
    signal.throwIfAborted();
    if (generation !== getSessionGeneration() || owner !== getStoredSessionOwnerKey())
      throw new Error('La sesión cambió. Vuelva a consultar.');
  };
  check();
  const runtime = await defaultFunctionsRuntime.getRegionalFunctions('southamerica-east1');
  check();
  const result = await httpsCallable<unknown, T>(runtime, endpoint, { timeout: 20000 })(request);
  check();
  return result.data;
};
export const loadCudyrReviews = async (month: string, signal: AbortSignal, reviewId?: string) => {
  const generation = getSessionGeneration(),
    owner = getStoredSessionOwnerKey();
  const reviews: SavedCudyrReview[] = [],
    seen = new Set<string>();
  let cursor: string | null = null;
  do {
    signal.throwIfAborted();
    if (generation !== getSessionGeneration() || owner !== getStoredSessionOwnerKey())
      throw new Error('La sesión cambió.');
    const page: { reviews: SavedCudyrReview[]; nextCursor: string | null } = await call(
      'readCudyrHistory',
      {
        kind: 'monthly-reviews',
        ...(reviewId ? { reviewId } : {}),
        month,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      },
      signal
    );
    reviews.push(...page.reviews);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('La lectura no avanzó. Vuelva a consultar.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return reviews;
};
export const saveCudyrReview = (
  request: {
    month: string;
    entryKey: string;
    expectedRevision: number;
    operationId: string;
    decision: CudyrReviewDecision;
    evidence: CudyrReviewEvidence;
  },
  signal: AbortSignal
) =>
  call<{ persisted: boolean; review: SavedCudyrReview }>(
    'archiveCudyrHistory',
    {
      ...request,
      kind: 'save-monthly-review',
      schemaVersion: 1,
      confirmed: true,
    },
    signal
  );
