import { describe, expect, it, vi } from 'vitest';
import { createRayenSyncPersistenceQueue } from '@/features/rayen-import/hooks/rayenSyncPersistenceQueue';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('rayenSyncPersistenceQueue', () => {
  it('serializes structural and audit persistence in submission order', async () => {
    const queue = createRayenSyncPersistenceQueue();
    const first = deferred<string>();
    const secondOperation = vi.fn(async () => 'audit-complete');

    const structural = queue.run(() => first.promise);
    const audit = queue.run(secondOperation);

    await Promise.resolve();
    expect(secondOperation).not.toHaveBeenCalled();

    first.resolve('structure-complete');
    await expect(structural).resolves.toBe('structure-complete');
    await expect(audit).resolves.toBe('audit-complete');
    expect(secondOperation).toHaveBeenCalledOnce();
  });

  it('continues with the next persistence operation after a rejected write', async () => {
    const queue = createRayenSyncPersistenceQueue();
    const failed = queue.run(async () => {
      throw new Error('conflict');
    });
    const next = queue.run(async () => 'recovered');

    await expect(failed).rejects.toThrow('conflict');
    await expect(next).resolves.toBe('recovered');
  });
});
