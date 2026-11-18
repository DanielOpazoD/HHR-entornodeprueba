import type { CudyrDailyExclusion, SaveCudyrExclusionRequest } from '@/types/domain/cudyrExclusion';
import { guardAuthoringSession } from '@/services/storage/authoringSession';
import { callCudyrFunction, type CudyrFunctionEndpoint } from './cudyrFunctionsCall';

/** Each call is its own operation, begun when the person acts: the guard is taken here. */
const call = <T>(endpoint: CudyrFunctionEndpoint, request: unknown, signal?: AbortSignal) =>
  callCudyrFunction<T>(
    endpoint,
    request,
    guardAuthoringSession({ signal, message: 'La sesión cambió. Vuelva a consultar.' })
  );
export const saveCudyrExclusion = (request: SaveCudyrExclusionRequest, signal: AbortSignal) =>
  call<{ persisted: boolean; exclusion: CudyrDailyExclusion }>(
    'archiveCudyrHistory',
    request,
    signal
  );
export const readCudyrExclusions = async (month: string, signal?: AbortSignal) => {
  const exclusions: CudyrDailyExclusion[] = [],
    seen = new Set<string>();
  let cursor: string | null = null;
  do {
    const page: { exclusions: CudyrDailyExclusion[]; nextCursor: string | null } = await call(
      'readCudyrHistory',
      { kind: 'daily-exclusions', month, ...(cursor ? { cursor } : {}) },
      signal
    );
    exclusions.push(...page.exclusions);
    cursor = page.nextCursor;
    if (cursor && (seen.has(cursor) || seen.size >= 1000))
      throw new Error('Lectura de exclusiones incompleta.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return exclusions;
};
