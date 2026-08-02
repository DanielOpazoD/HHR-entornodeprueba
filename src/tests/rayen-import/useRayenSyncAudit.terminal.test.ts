import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRayenSyncAudit } from '@/features/rayen-import/hooks/useRayenSyncAudit';
import { logger } from '@/services/utils/loggerService';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';

const record = (): DailyRecord =>
  ({
    date: '2026-08-02',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-08-02T09:00:00.000Z',
    activeExtraBeds: [],
  }) as DailyRecord;

const diff = (): CensusImportDiff =>
  ({
    admissions: [],
    updates: [],
    moves: [],
    discharges: [],
    pendingAdministrativeDischarges: [],
    conflicts: [],
    unchangedCount: 1,
    summary: {
      admissions: 0,
      updates: 0,
      moves: 0,
      discharges: 0,
      pendingAdministrativeDischarges: 0,
      conflicts: 0,
      unchanged: 1,
    },
  }) as CensusImportDiff;

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

describe('useRayenSyncAudit terminal outcomes', () => {
  it('persists a completed outcome exactly once under concurrent completion callbacks', async () => {
    const pendingWrite = deferred<undefined>();
    const patchDailyRecord = vi.fn().mockReturnValue(pendingWrite.promise);
    const currentRecordRef = { current: record() };
    const { result } = renderHook(() =>
      useRayenSyncAudit({
        currentRecordRef,
        patchDailyRecord,
        actor: 'Operador HHR',
        createId: () => 'single-terminal-run',
      })
    );
    act(() => result.current.startRun());
    const applied = result.current.applyRunToRecord(currentRecordRef.current, diff()).record;
    currentRecordRef.current = applied;

    let first!: Promise<void>;
    let duplicate!: Promise<void>;
    act(() => {
      first = result.current.completeRun(applied, { total: 1, patched: 1, errors: [] });
      duplicate = result.current.completeRun(applied, { total: 1, patched: 1, errors: [] });
    });
    expect(patchDailyRecord).toHaveBeenCalledTimes(1);
    pendingWrite.resolve(undefined);
    await act(async () => Promise.all([first, duplicate]));

    await act(async () => {
      await result.current.completeRun(applied, { total: 1, patched: 1, errors: [] });
    });
    expect(patchDailyRecord).toHaveBeenCalledTimes(1);
  });

  it('lets the first terminal path win when completion and failure race', async () => {
    const pendingWrite = deferred<undefined>();
    const patchDailyRecord = vi.fn().mockReturnValue(pendingWrite.promise);
    const currentRecordRef = { current: record() };
    const { result } = renderHook(() =>
      useRayenSyncAudit({
        currentRecordRef,
        patchDailyRecord,
        actor: 'Operador HHR',
        createId: () => 'racing-run',
      })
    );
    act(() => result.current.startRun());
    const applied = result.current.applyRunToRecord(currentRecordRef.current, diff()).record;
    currentRecordRef.current = applied;

    let completion!: Promise<void>;
    act(() => {
      completion = result.current.completeRun(applied, { total: 1, patched: 1, errors: [] });
    });
    await act(async () => result.current.failRun('snapshot_error'));
    expect(patchDailyRecord).toHaveBeenCalledTimes(1);
    pendingWrite.resolve(undefined);
    await act(async () => completion);

    const persisted = patchDailyRecord.mock.calls[0][0].rayenSyncHistory as Array<{
      status: string;
    }>;
    expect(persisted[0]?.status).toBe('complete');
  });

  it('contains a failed audit write and releases the lifecycle for the next run', async () => {
    const patchDailyRecord = vi.fn().mockRejectedValue(new Error('provider detail'));
    const ids = ['failed-run', 'next-run'];
    const currentRecordRef = { current: record() };
    const { result } = renderHook(() =>
      useRayenSyncAudit({
        currentRecordRef,
        patchDailyRecord,
        actor: 'Operador HHR',
        createId: () => ids.shift() ?? 'extra-run',
      })
    );

    act(() => result.current.startRun());
    await expect(
      act(async () => result.current.failRun('snapshot_error'))
    ).resolves.toBeUndefined();
    const next = result.current.ensureRun();

    expect(next.id).toBe('next-run');
    expect(patchDailyRecord).toHaveBeenCalledTimes(1);
  });

  it('persists a failed terminal event when the completed audit event cannot be saved', async () => {
    const patchDailyRecord = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider detail'))
      .mockResolvedValueOnce(undefined);
    const ids = ['completion-write-failed', 'next-run'];
    const currentRecordRef = { current: record() };
    const consoleWarning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logger.clearEntries();
    const { result } = renderHook(() =>
      useRayenSyncAudit({
        currentRecordRef,
        patchDailyRecord,
        actor: 'Operador HHR',
        createId: () => ids.shift() ?? 'extra-run',
      })
    );
    act(() => result.current.startRun());
    const applied = result.current.applyRunToRecord(currentRecordRef.current, diff()).record;
    currentRecordRef.current = applied;

    let failedCompletion!: Promise<void>;
    act(() => {
      failedCompletion = result.current.completeRun(applied, {
        total: 1,
        patched: 1,
        errors: [],
      });
    });
    await expect(failedCompletion).rejects.toThrow('provider detail');
    await expect(
      result.current.completeRun(applied, { total: 1, patched: 1, errors: [] })
    ).resolves.toBeUndefined();

    expect(patchDailyRecord).toHaveBeenCalledTimes(2);
    expect(patchDailyRecord.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        rayenSync: expect.objectContaining({
          runId: 'completion-write-failed',
          status: 'applied',
        }),
        rayenSyncHistory: [
          expect.objectContaining({
            id: 'completion-write-failed',
            status: 'failed',
            failureReason: 'apply_failed',
          }),
        ],
      })
    );
    expect(result.current.ensureRun().id).toBe('next-run');
    expect(logger.getEntries()).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'run_terminal',
        context: 'RayenSync',
        data: expect.objectContaining({
          runId: 'completion-write-failed',
          outcome: 'failed',
          failureReason: 'apply_failed',
        }),
      })
    );
    consoleWarning.mockRestore();
    logger.clearEntries();
  });

  it('keeps completion retryable when neither the terminal event nor its fallback persisted', async () => {
    const patchDailyRecord = vi
      .fn()
      .mockRejectedValueOnce(new Error('completion unavailable'))
      .mockRejectedValueOnce(new Error('fallback unavailable'))
      .mockResolvedValueOnce(undefined);
    const currentRecordRef = { current: record() };
    const consoleWarning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderHook(() =>
      useRayenSyncAudit({
        currentRecordRef,
        patchDailyRecord,
        actor: 'Operador HHR',
        createId: () => 'retryable-run',
      })
    );
    act(() => result.current.startRun());
    const applied = result.current.applyRunToRecord(currentRecordRef.current, diff()).record;
    currentRecordRef.current = applied;

    await expect(
      result.current.completeRun(applied, { total: 1, patched: 1, errors: [] })
    ).rejects.toThrow('completion unavailable');
    await expect(
      result.current.completeRun(applied, { total: 1, patched: 1, errors: [] })
    ).resolves.toBeUndefined();

    expect(patchDailyRecord).toHaveBeenCalledTimes(3);
    expect(patchDailyRecord.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        rayenSyncHistory: [expect.objectContaining({ id: 'retryable-run', status: 'complete' })],
      })
    );
    consoleWarning.mockRestore();
    logger.clearEntries();
  });

  it('fails the correlated older run without terminalizing a newer active capture', async () => {
    const patchDailyRecord = vi.fn().mockResolvedValue(undefined);
    const ids = ['older-run', 'newer-run'];
    const currentRecordRef = { current: record() };
    const { result } = renderHook(() =>
      useRayenSyncAudit({
        currentRecordRef,
        patchDailyRecord,
        actor: 'Operador HHR',
        createId: () => ids.shift() ?? 'extra-run',
      })
    );

    act(() => result.current.startRun());
    const olderApplied = result.current.applyRunToRecord(currentRecordRef.current, diff()).record;
    currentRecordRef.current = olderApplied;
    act(() => result.current.startRun());
    await act(async () => result.current.failRun('snapshot_error', 'older-run'));

    expect(result.current.ensureRun().id).toBe('newer-run');
    expect(patchDailyRecord).toHaveBeenCalledWith({
      rayenSyncHistory: [expect.objectContaining({ id: 'older-run', status: 'failed' })],
    });
  });
});
