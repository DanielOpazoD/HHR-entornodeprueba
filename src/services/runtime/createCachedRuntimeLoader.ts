export const createCachedRuntimeLoader = <T>(
  resolveRuntime: () => Promise<T>,
  mapError?: (error: unknown) => unknown
): (() => Promise<T>) => {
  let runtimePromise: Promise<T> | null = null;

  return async (): Promise<T> => {
    try {
      runtimePromise ??= resolveRuntime();
      return await runtimePromise;
    } catch (error) {
      runtimePromise = null;
      throw mapError ? mapError(error) : error;
    }
  };
};
