import { expect, it, vi } from 'vitest';
import { createDicomComparisonOwner } from '@/services/radiology/dicomComparisonOwner';
import type { DicomComparison } from '@/services/radiology/dicomComparison';
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => {
    resolve = yes;
  });
  return { promise, resolve };
};
const session = (dispose = vi.fn().mockResolvedValue(undefined)) =>
  ({ dispose }) as unknown as DicomComparison;
it('aborts and drains an in-flight setup before the original view can resume', async () => {
  const owner = createDicomComparisonOwner(),
    setup = deferred<DicomComparison>();
  let signal!: AbortSignal;
  const opening = owner.open(async value => {
    signal = value;
    return setup.promise;
  });
  void opening.catch(() => undefined);
  await vi.waitFor(() => expect(signal).toBeDefined());
  let restored = false;
  const closing = owner.close().then(() => {
    restored = true;
  });
  expect(signal.aborted).toBe(true);
  await Promise.resolve();
  expect(restored).toBe(false);
  const built = session();
  setup.resolve(built);
  await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
  await closing;
  expect(built.dispose).toHaveBeenCalledTimes(1);
  expect(restored).toBe(true);
});
it('waits for old resources to drain before starting the replacement', async () => {
  const owner = createDicomComparisonOwner(),
    draining = deferred<void>();
  await owner.open(async () => session(vi.fn(() => draining.promise)));
  const build = vi.fn(async () => session());
  const replacing = owner.open(build);
  await Promise.resolve();
  expect(build).not.toHaveBeenCalled();
  draining.resolve();
  await replacing;
  expect(build).toHaveBeenCalledTimes(1);
  await owner.close();
});
it('does not create a view if closed before setup starts and can recover after a rejection', async () => {
  const owner = createDicomComparisonOwner(),
    build = vi.fn(async () => session());
  const opening = owner.open(build);
  void opening.catch(() => undefined);
  await owner.close();
  await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
  expect(build).not.toHaveBeenCalled();
  await expect(
    owner.open(async () => {
      throw new Error('synthetic');
    })
  ).rejects.toThrow('synthetic');
  const next = session();
  await expect(owner.open(async () => next)).resolves.toBe(next);
  await owner.close();
  expect(next.dispose).toHaveBeenCalledTimes(1);
});
