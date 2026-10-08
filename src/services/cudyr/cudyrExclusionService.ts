import { httpsCallable } from 'firebase/functions';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { CudyrDailyExclusion, SaveCudyrExclusionRequest } from '@/types/domain/cudyrExclusion';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionScopedStorageService';
import { getSessionGeneration } from '@/services/storage/sessionStorageTransition';

const call = async <T>(endpoint: string, request: unknown, signal?: AbortSignal): Promise<T> => {
  const generation = getSessionGeneration(),
    owner = getStoredSessionOwnerKey();
  const check = () => {
    signal?.throwIfAborted();
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
