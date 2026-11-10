import type { Firestore } from 'firebase/firestore';

export type TelemetryStatus = 'success' | 'failure' | 'timeout';

export interface TelemetryInvocation {
  service: string;
  operation: string;
  hospitalId?: string;
  durationMs: number;
  attempt: number;
  totalAttempts: number;
  status: TelemetryStatus;
  errorCode?: string;
  errorMessage?: string;
  context?: Record<string, string | number | boolean>;
}

export interface InvokeOptions<T> {
  service: string;
  operation: string;
  timeoutMs: number;
  maxAttempts?: number;
  backoffBaseMs?: number;
  isTransientError?: (error: unknown) => boolean;
  /** Classifies a returned result for telemetry only; never retries or changes it. */
  isFailureResult?: (result: T) => boolean;
  hospitalId?: string;
  db?: Firestore;
  context?: Record<string, string | number | boolean>;
  fn: () => Promise<T>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BACKOFF_BASE_MS = 300;
const TELEMETRY_COLLECTION = 'functionsTelemetry';

const defaultIsTransient = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const errObj = error as { code?: string | number; status?: number; message?: string };
  const status = typeof errObj.status === 'number' ? errObj.status : undefined;
  if (status && status >= 500 && status < 600) return true;
  if (status === 429) return true;
  if (errObj.code === 'ETIMEDOUT' || errObj.code === 'ECONNRESET') return true;
  if (typeof errObj.message === 'string' && /timeout|ETIMEDOUT|ECONNRESET/i.test(errObj.message)) {
    return true;
  }
  return false;
};

const errorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const errObj = error as { code?: string | number; status?: number };
  if (errObj.code !== undefined) return String(errObj.code);
  if (errObj.status !== undefined) return String(errObj.status);
  return undefined;
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'unknown error';
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const withTimeout = async <T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Operation timed out after ${timeoutMs}ms`);
      (error as Error & { code?: string }).code = 'ETIMEDOUT';
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const writeTelemetrySink = async (
  db: Firestore,
  hospitalId: string,
  entry: TelemetryInvocation
): Promise<void> => {
  try {
    if (typeof process !== 'undefined' && process.env.VITEST === 'true') {
      return;
    }

    const firestore = await import('firebase/firestore');

    // Some test environments partially mock Firestore without write helpers.
    // Telemetry must degrade quietly there instead of polluting stderr.
    if (typeof firestore.collection !== 'function' || typeof firestore.addDoc !== 'function') {
      return;
    }

    const ref = firestore.collection(db, `hospitals/${hospitalId}/${TELEMETRY_COLLECTION}`);
    await firestore.addDoc(ref, { ...entry, timestamp: new Date().toISOString() });
  } catch (sinkError) {
    // Sink failure must not mask the original operation outcome.
    console.error(
      JSON.stringify({
        level: 'error',
        kind: 'telemetry_sink_failed',
        service: entry.service,
        operation: entry.operation,
        message: errorMessage(sinkError),
      })
    );
  }
};

export const invokeWithTelemetry = async <T>(options: InvokeOptions<T>): Promise<T> => {
  const {
    service,
    operation,
    timeoutMs,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    backoffBaseMs = DEFAULT_BACKOFF_BASE_MS,
    isTransientError = defaultIsTransient,
    isFailureResult,
    hospitalId,
    db,
    context,
    fn,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const startedAt = Date.now();
    try {
      const result = await withTimeout(fn, timeoutMs);
      const failed = isFailureResult?.(result) ?? false;
      const entry: TelemetryInvocation = {
        service,
        operation,
        hospitalId,
        durationMs: Date.now() - startedAt,
        attempt,
        totalAttempts: maxAttempts,
        status: failed ? 'failure' : 'success',
        ...(failed
          ? { errorCode: 'FAILURE_RESULT', errorMessage: 'Operation returned a failure result' }
          : {}),
        context,
      };
      if (failed) {
        console.error(
          JSON.stringify({
            level: 'error',
            kind: 'function_invocation',
            willRetry: false,
            ...entry,
          })
        );
      } else {
        process.stdout.write(
          `${JSON.stringify({ level: 'info', kind: 'function_invocation', ...entry })}\n`
        );
      }
      if (db && hospitalId) void writeTelemetrySink(db, hospitalId, entry);
      return result;
    } catch (error) {
      lastError = error;
      const isTimeout = errorCode(error) === 'ETIMEDOUT';
      const transient = isTimeout || isTransientError(error);
      const willRetry = transient && attempt < maxAttempts;

      const entry: TelemetryInvocation = {
        service,
        operation,
        hospitalId,
        durationMs: Date.now() - startedAt,
        attempt,
        totalAttempts: maxAttempts,
        status: isTimeout ? 'timeout' : 'failure',
        errorCode: errorCode(error),
        errorMessage: errorMessage(error),
        context,
      };
      console.error(
        JSON.stringify({
          level: willRetry ? 'warn' : 'error',
          kind: 'function_invocation',
          willRetry,
          ...entry,
        })
      );
      if (db && hospitalId) void writeTelemetrySink(db, hospitalId, entry);

      if (!willRetry) throw error;

      const backoff = backoffBaseMs * 2 ** (attempt - 1);
      await sleep(backoff);
    }
  }

  // Defensive: loop should have returned or thrown. Rethrow for completeness.
  throw lastError instanceof Error ? lastError : new Error('invokeWithTelemetry exhausted');
};
