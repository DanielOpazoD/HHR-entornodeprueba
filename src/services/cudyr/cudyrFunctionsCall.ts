import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { AuthoringSessionGuard } from '@/services/storage/authoringSession';

/** Where each CUDYR Function runs, and its client timeout (undefined: the SDK's default). */
const ENDPOINTS = {
  archiveCudyrHistory: { region: 'southamerica-east1', timeout: 20_000 },
  readCudyrHistory: { region: 'southamerica-east1', timeout: 20_000 },
  setAdminCudyrResult: { region: undefined, timeout: undefined },
} as const;
export type CudyrFunctionEndpoint = keyof typeof ENDPOINTS;

/**
 * The one door through which CUDYR work leaves for its Functions. `guard` is the one the operation
 * captured when it began (before its first wait), never one taken here: the door asks it right
 * before sending, so what A confirmed is never sent once this browser holds B, or after A's logout
 * began. A refused call sends nothing and throws the guard's error; the caller stops in silence.
 */
export const callCudyrFunction = async <Result, Request = unknown>(
  endpoint: CudyrFunctionEndpoint,
  request: Request,
  guard: AuthoringSessionGuard
): Promise<Result> => {
  guard.check();
  const { region, timeout } = ENDPOINTS[endpoint];
  const runtime = region
    ? await defaultFunctionsRuntime.getRegionalFunctions(region)
    : await defaultFunctionsRuntime.getFunctions();
  const { httpsCallable } = await import('firebase/functions');
  guard.check();
  let result: { data: Result };
  try {
    result = await httpsCallable<Request, Result>(
      runtime,
      endpoint,
      timeout ? { timeout } : undefined
    )(request);
  } catch (error) {
    // A session change wins over the server's answer: the reply belongs to someone else's work.
    guard.check();
    throw error;
  }
  guard.check();
  return result.data;
};
