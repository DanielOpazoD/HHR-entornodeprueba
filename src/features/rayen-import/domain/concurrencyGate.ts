/**
 * Runs asynchronous operations with a small FIFO concurrency limit.
 *
 * Unlike fixed-size batches, a new operation starts as soon as an active slot is released. This
 * prevents a slow patient write from delaying unrelated Eloisa reads while preserving explicit
 * backpressure on PDF parsing and extension traffic.
 */
export const createConcurrencyGate = (limit: number) => {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Concurrency limit must be a positive integer.');
  }

  let active = 0;
  const waiting: Array<() => void> = [];

  const acquire = async (): Promise<void> => {
    if (active < limit) {
      active += 1;
      return;
    }
    await new Promise<void>(resolve => waiting.push(resolve));
  };

  const release = (): void => {
    const next = waiting.shift();
    if (next) {
      next();
      return;
    }
    active -= 1;
  };

  return async <T>(operation: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  };
};
