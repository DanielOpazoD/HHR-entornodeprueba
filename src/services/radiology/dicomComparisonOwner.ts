import type { DicomComparison } from './dicomComparison';

/** Serializes setup, replacement and teardown, including a close before setup resolves. */
export const createDicomComparisonOwner = () => {
  let current: DicomComparison | undefined;
  let controller: AbortController | undefined;
  let pending: Promise<void> = Promise.resolve();
  const close = () => {
    controller?.abort();
    return Promise.all([pending, current?.dispose()]).then(() => undefined);
  };
  return {
    close,
    open: (build: (signal: AbortSignal) => Promise<DicomComparison>) => {
      const previous = close();
      const next = new AbortController();
      controller = next;
      const result = previous.then(async () => {
        next.signal.throwIfAborted();
        const value = await build(next.signal);
        if (next.signal.aborted) {
          await value.dispose();
          next.signal.throwIfAborted();
        }
        current = value;
        return value;
      });
      // Rejection is delivered to the opener; cleanup/replacement must still drain it.
      pending = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
  };
};
