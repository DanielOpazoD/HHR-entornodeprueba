import { describe, expect, it, vi } from 'vitest';
import {
  runExclusiveDailyRecordWrite,
  runWithDailyRecordWriteLock,
} from '@/services/repositories/dailyRecordWriteCoordinator';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(next => {
    resolve = next;
  });
  return { promise, resolve };
};

describe('dailyRecordWriteCoordinator', () => {
  it('keeps an ordinary same-day write behind the complete structural critical section', async () => {
    const structuralStarted = deferred();
    const releaseStructural = deferred();
    const ordinaryWrite = vi.fn(async () => undefined);

    const structural = runExclusiveDailyRecordWrite('2026-08-17', async lease => {
      structuralStarted.resolve();
      await releaseStructural.promise;
      await runWithDailyRecordWriteLock('2026-08-17', lease, async () => undefined);
    });
    await structuralStarted.promise;
    const ordinary = runWithDailyRecordWriteLock('2026-08-17', undefined, ordinaryWrite);

    await Promise.resolve();
    expect(ordinaryWrite).not.toHaveBeenCalled();
    releaseStructural.resolve();
    await Promise.all([structural, ordinary]);
    expect(ordinaryWrite).toHaveBeenCalledOnce();
  });

  it('does not serialize independent census dates', async () => {
    const releaseFirstDate = deferred();
    const secondDateWrite = vi.fn(async () => undefined);
    const first = runExclusiveDailyRecordWrite('2026-08-17', async () => {
      await releaseFirstDate.promise;
    });

    await runWithDailyRecordWriteLock('2026-08-16', undefined, secondDateWrite);
    expect(secondDateWrite).toHaveBeenCalledOnce();
    releaseFirstDate.resolve();
    await first;
  });
});
