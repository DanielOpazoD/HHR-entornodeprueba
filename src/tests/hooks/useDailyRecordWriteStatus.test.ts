import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDailyRecordWriteStatus } from '@/hooks/useDailyRecordWriteStatus';
import { runExclusiveDailyRecordWrite } from '@/services/repositories/dailyRecordWriteCoordinator';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('useDailyRecordWriteStatus', () => {
  it.each(['clinical_sync', 'structural_sync'] as const)(
    'pauses only the acquired %s turn, then releases after failure',
    async kind => {
      const date = `hook-${kind}`;
      const ordinaryGate = deferred();
      const syncGate = deferred();
      const view = renderHook(() => useDailyRecordWriteStatus(date));
      let ordinary!: Promise<void>;
      let sync!: Promise<unknown>;
      try {
        await act(async () => {
          ordinary = runExclusiveDailyRecordWrite(date, () => ordinaryGate.promise);
        });
        expect(view.result.current).toEqual({
          pendingCount: 1,
          activeKind: 'ordinary',
          isSyncCommit: false,
        });
        await act(async () => {
          sync = runExclusiveDailyRecordWrite(
            date,
            async () => {
              await syncGate.promise;
              throw new Error('Rejected sync');
            },
            { kind }
          ).catch(error => error);
        });
        expect(view.result.current).toEqual({
          pendingCount: 2,
          activeKind: 'ordinary',
          isSyncCommit: false,
        });
        await act(async () => {
          ordinaryGate.resolve();
          await ordinary;
        });
        expect(view.result.current).toEqual({
          pendingCount: 1,
          activeKind: kind,
          isSyncCommit: true,
        });
        await act(async () => {
          syncGate.resolve();
          await sync;
        });
        expect(view.result.current).toEqual({
          pendingCount: 0,
          activeKind: null,
          isSyncCommit: false,
        });
      } finally {
        ordinaryGate.resolve();
        syncGate.resolve();
        await Promise.all([ordinary, sync]);
        view.unmount();
      }
    }
  );

  it('subscribes to the selected date and leaves other dates independent', async () => {
    const gate = deferred();
    const view = renderHook(({ date }) => useDailyRecordWriteStatus(date), {
      initialProps: { date: 'hook-selected-date' },
    });
    let write!: Promise<void>;
    try {
      await act(async () => {
        write = runExclusiveDailyRecordWrite('hook-other-date', () => gate.promise, {
          kind: 'clinical_sync',
        });
      });
      expect(view.result.current.isSyncCommit).toBe(false);
      view.rerender({ date: 'hook-other-date' });
      expect(view.result.current.isSyncCommit).toBe(true);
      view.rerender({ date: 'hook-selected-date' });
      await act(async () => {
        gate.resolve();
        await write;
      });
      expect(view.result.current).toEqual({
        pendingCount: 0,
        activeKind: null,
        isSyncCommit: false,
      });
    } finally {
      gate.resolve();
      await write;
      view.unmount();
    }
  });
});
