/**
 * Wall-clock ceiling for a stage promise. The timer is always cleared so a fast promise never
 * leaves a dangling rejection behind. Shared by the context read and the structural persist so
 * the authenticated shell carries one copy of the race instead of one per stage.
 */
export const raceWithTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  createError: () => Error
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(createError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
