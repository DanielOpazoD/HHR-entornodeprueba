// The browser lock covers shared IndexedDB/localStorage; the promise queue is
// also needed in a single document (and in runtimes without Web Locks).
let pending: Promise<unknown> = Promise.resolve();
export const SESSION_GENERATION_KEY = 'hhr_session_generation_v1';
let admittedGeneration: string | null = null;

export const getSessionGeneration = (): string | null => admittedGeneration;
export const getLogoutGeneration = (): string | null => {
  // A bootstrap document has not admitted an owner yet. Shared storage may
  // already belong to a replacement in another tab; it is not local proof.
  return admittedGeneration;
};
export const setSessionGeneration = (generation: string | null): void => {
  admittedGeneration = generation;
};

export const runSessionStorageTransition = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = pending.then(() => {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
      return navigator.locks.request('hhr-session-storage-transition', operation);
    }
    return operation();
  });
  pending = result.catch(() => undefined);
  return result;
};
