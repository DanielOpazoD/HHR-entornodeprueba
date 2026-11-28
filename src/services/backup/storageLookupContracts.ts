import type { StorageLookupStatus } from '@/services/backup/storageErrorPolicy';

export interface StorageLookupResult {
  exists: boolean;
  status: StorageLookupStatus;
}

export const createStorageLookupResult = (
  exists: boolean,
  status: StorageLookupStatus
): StorageLookupResult => ({
  exists,
  status,
});

export const withStorageDeadline = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T | Promise<T>
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>(resolve => {
    timer = setTimeout(() => resolve(Promise.resolve().then(onTimeout)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

export const withStorageLookupTimeout = (
  promise: Promise<StorageLookupResult>,
  timeoutMs: number,
  onTimeout?: () => void
): Promise<StorageLookupResult> =>
  withStorageDeadline(promise, timeoutMs, () => {
    onTimeout?.();
    return createStorageLookupResult(false, 'timeout');
  });
