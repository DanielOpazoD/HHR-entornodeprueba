import { describe, expect, it, vi } from 'vitest';
import {
  runExclusiveDailyRecordWrite,
  runWithDailyRecordWriteLock,
  getDailyRecordWriteState,
  subscribeDailyRecordWriteState,
} from '@/services/repositories/dailyRecordWriteCoordinator';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(next => {
    resolve = next;
  });
  return { promise, resolve };
};

describe('dailyRecordWriteCoordinator', () => {
  it('publishes the active owner only after its turn starts and reuses idle snapshots', async () => {
    const date = '2026-09-02';
    const idle = getDailyRecordWriteState(date);
    const started = deferred();
    const releaseOrdinary = deferred();
    const releaseClinical = deferred();
    const observations: ReturnType<typeof getDailyRecordWriteState>[] = [];
    const unsubscribe = subscribeDailyRecordWriteState(date, () => {
      observations.push(getDailyRecordWriteState(date));
    });
    const ordinary = runExclusiveDailyRecordWrite(date, async () => {
      started.resolve();
      await releaseOrdinary.promise;
    });
    await started.promise;
    const clinical = runExclusiveDailyRecordWrite(
      date,
      async lease => {
        await runWithDailyRecordWriteLock(date, lease, async () => undefined);
        await releaseClinical.promise;
      },
      { kind: 'clinical_sync' }
    );
    expect(getDailyRecordWriteState(date)).toEqual({ pendingCount: 2, activeKind: 'ordinary' });
    expect(getDailyRecordWriteState(date)).toBe(getDailyRecordWriteState(date));
    releaseOrdinary.resolve();
    await ordinary;
    await vi.waitFor(() => expect(getDailyRecordWriteState(date).activeKind).toBe('clinical_sync'));
    releaseClinical.resolve();
    await clinical;
    expect(getDailyRecordWriteState(date)).toBe(idle);
    expect(observations).toContainEqual({ pendingCount: 1, activeKind: 'clinical_sync' });
    unsubscribe();
    const count = observations.length;
    await runExclusiveDailyRecordWrite(date, async () => undefined);
    expect(observations).toHaveLength(count);
  });

  it('releases a rejected turn even if a state observer throws', async () => {
    const date = '2026-09-03';
    const unsubscribe = subscribeDailyRecordWriteState(date, () => {
      throw new Error('observer');
    });
    const failed = runExclusiveDailyRecordWrite(
      date,
      async () => {
        throw new Error('write');
      },
      { kind: 'structural_sync' }
    );
    const next = vi.fn(async () => undefined);
    const nextTurn = runExclusiveDailyRecordWrite(date, next);
    await expect(failed).rejects.toThrow('write');
    await nextTurn;
    expect(next).toHaveBeenCalledOnce();
    expect(getDailyRecordWriteState(date)).toEqual({ pendingCount: 0, activeKind: null });
    unsubscribe();
  });

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
