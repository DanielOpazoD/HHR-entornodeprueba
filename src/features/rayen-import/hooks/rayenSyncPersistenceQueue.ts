export interface RayenSyncPersistenceQueue {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * Serializes census and audit persistence for the active browser session.
 * A rejected write does not poison the tail, so the next correlated execution can still proceed.
 */
export const createRayenSyncPersistenceQueue = (): RayenSyncPersistenceQueue => {
  let tail: Promise<void> = Promise.resolve();

  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation);
      tail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
  };
};
