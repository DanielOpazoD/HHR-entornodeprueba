export interface IndexedDbErrorDetails {
  errorName: string;
  errorMessage: string;
}

export type IndexedDbOpenWaitOutcome = 'opened' | 'mock' | 'stalled' | 'settled';

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export const runIndexedDbOperationWithTimeout = async <T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

export const resolveIndexedDbErrorDetails = (error: unknown): IndexedDbErrorDetails => ({
  errorName: error && typeof error === 'object' && 'name' in error ? String(error.name) : 'Unknown',
  errorMessage:
    error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : String(error),
});

export const isDatabaseClosedError = (error: unknown): boolean =>
  Boolean(
    error &&
    typeof error === 'object' &&
    (error as { name?: string }).name === 'DatabaseClosedError'
  );

export const resolveIndexedDbRecoveryDelay = (
  attempt: number,
  retryDelays: readonly number[]
): number => retryDelays[Math.min(Math.max(attempt - 1, 0), retryDelays.length - 1)] ?? 0;

export const openIndexedDbWithRetries = async ({
  open,
  retryDelays,
  wait = sleep,
}: {
  open: () => Promise<unknown>;
  retryDelays: readonly number[];
  wait?: (ms: number) => Promise<void>;
}): Promise<void> => {
  let openError: unknown = undefined;

  for (const retryDelay of retryDelays) {
    try {
      await open();
      return;
    } catch (attemptError) {
      openError = attemptError;
      await wait(retryDelay);
    }
  }

  throw openError || new Error('IndexedDB open failed');
};

export const waitForIndexedDbOpenResolution = async ({
  isOpening,
  isDbOpen,
  isUsingMock,
  maxAttempts = 50,
  pollIntervalMs = 100,
  wait = sleep,
}: {
  isOpening: () => boolean;
  isDbOpen: () => boolean;
  isUsingMock: () => boolean;
  maxAttempts?: number;
  pollIntervalMs?: number;
  wait?: (ms: number) => Promise<void>;
}): Promise<IndexedDbOpenWaitOutcome> => {
  let attempts = 0;

  while (isOpening() && attempts < maxAttempts) {
    await wait(pollIntervalMs);
    attempts++;

    if (isDbOpen()) {
      return 'opened';
    }
    if (isUsingMock()) {
      return 'mock';
    }
  }

  if (isOpening()) {
    return 'stalled';
  }
  if (isDbOpen()) {
    return 'opened';
  }
  if (isUsingMock()) {
    return 'mock';
  }
  return 'settled';
};
