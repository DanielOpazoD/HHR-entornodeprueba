import { guardAuthoringSession } from '@/services/session/authoringSession';
import { callCudyrFunction, type CudyrFunctionEndpoint } from '@/services/cudyr/cudyrFunctionsCall';
import type {
  CudyrReviewDecision,
  CudyrReviewEvidence,
  SavedCudyrReview,
} from '@/types/domain/cudyrReview';

/** Each call is its own operation, begun when the person acts: the guard is taken here. */
const call = <T>(endpoint: CudyrFunctionEndpoint, request: unknown, signal: AbortSignal) =>
  callCudyrFunction<T>(
    endpoint,
    request,
    guardAuthoringSession({ signal, message: 'La sesión cambió. Vuelva a consultar.' })
  );
export const loadCudyrReviews = async (month: string, signal: AbortSignal, reviewId?: string) => {
  const { check } = guardAuthoringSession({ signal });
  const reviews: SavedCudyrReview[] = [],
    seen = new Set<string>();
  let cursor: string | null = null;
  do {
    check();
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
