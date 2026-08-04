import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRayenSyncAudit } from '@/features/rayen-import/hooks/useRayenSyncAudit';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';

const record = (): DailyRecord =>
  ({
    date: '2026-07-14',
    beds: {},
    discharges: [],
    transfers: [],
    cma: [],
    lastUpdated: '2026-07-14T09:00:00.000Z',
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
    unchangedCount: 2,
    summary: {
      admissions: 0,
      updates: 0,
      moves: 0,
      discharges: 0,
      pendingAdministrativeDischarges: 0,
      conflicts: 0,
      unchanged: 2,
    },
  }) as CensusImportDiff;

describe('useRayenSyncAudit', () => {
  it('updates the same applied event when clinical coverage completes', async () => {
    const patchDailyRecord = vi.fn().mockResolvedValue(undefined);
    const currentRecordRef = { current: record() };
    const times = [
      new Date('2026-07-14T10:00:00.000Z'),
      new Date('2026-07-14T10:01:00.000Z'),
      new Date('2026-07-14T10:03:00.000Z'),
    ];
    const { result } = renderHook(() =>
      useRayenSyncAudit({
        currentRecordRef,
        patchDailyRecord,
        actor: 'Operador HHR',
        now: () => times.shift() ?? new Date('2026-07-14T10:03:00.000Z'),
        createId: () => 'run-1',
      })
    );

    act(() => {
      result.current.startRun(
        undefined,
        {
          stagesMs: { preflight: 50 },
          counters: { requests: 1 },
        },
        { mode: 'auto', revision: 7 }
      );
      result.current.recordRunPerformance({
        stagesMs: { dualCapture: 200 },
        counters: { requests: 1, cacheHits: 1 },
      });
    });
    const stamped = result.current.applyRunToRecord(currentRecordRef.current, diff()).record;
    currentRecordRef.current = stamped;
    await act(async () => {
      await result.current.completeRun(stamped, {
        total: 2,
        patched: 1,
        errors: [],
        performance: {
          stagesMs: { clinicalReads: 900, persistence: 100 },
          counters: { requests: 4, cacheHits: 0, patches: 1, retries: 0, timeouts: 0 },
        },
      });
    });

    expect(stamped.rayenSyncHistory).toHaveLength(1);
    expect(patchDailyRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        rayenSync: expect.objectContaining({ runId: 'run-1', status: 'complete' }),
        rayenSyncHistory: [
          expect.objectContaining({
            id: 'run-1',
            status: 'complete',
            policy: { mode: 'auto', revision: 7 },
            coverage: expect.any(Object),
            performance: {
              stagesMs: {
                preflight: 50,
                dualCapture: 200,
                clinicalReads: 900,
                persistence: 100,
              },
              counters: {
                requests: 6,
                cacheHits: 1,
                patches: 1,
                retries: 0,
                timeouts: 0,
              },
            },
          }),
        ],
      })
    );
    expect(patchDailyRecord.mock.calls[0][0].rayenSync).not.toHaveProperty('performance');
  });

  it('records a sanitized failure but never replaces the latest applied sync projection', async () => {
    const patchDailyRecord = vi.fn().mockResolvedValue(undefined);
    const currentRecordRef = {
      current: {
        ...record(),
        rayenSync: { at: '2026-07-14T09:00:00.000Z', by: 'Anterior' },
      },
    };
    const { result } = renderHook(() =>
      useRayenSyncAudit({
        currentRecordRef,
        patchDailyRecord,
        actor: 'Operador HHR',
        now: () => new Date('2026-07-14T10:00:00.000Z'),
        createId: () => 'failed-run',
      })
    );

    act(() => {
      result.current.startRun();
    });
    await act(async () => {
      await result.current.failRun('snapshot_timeout');
    });

    expect(patchDailyRecord).toHaveBeenCalledWith({
      rayenSyncHistory: [
        expect.objectContaining({
          id: 'failed-run',
          status: 'failed',
          failureReason: 'snapshot_timeout',
        }),
      ],
    });
    expect(patchDailyRecord.mock.calls[0][0]).not.toHaveProperty('rayenSync');
  });

  it('completes the applied run even when a newer run becomes active', async () => {
    const patchDailyRecord = vi.fn().mockResolvedValue(undefined);
    const currentRecordRef = { current: record() };
    const ids = ['run-1', 'run-2'];
    const { result } = renderHook(() =>
      useRayenSyncAudit({
        currentRecordRef,
        patchDailyRecord,
        actor: 'Operador HHR',
        now: () => new Date('2026-07-14T10:00:00.000Z'),
        createId: () => ids.shift() ?? 'run-extra',
      })
    );

    act(() => {
      result.current.startRun();
    });
    const firstApplied = result.current.applyRunToRecord(currentRecordRef.current, diff()).record;
    currentRecordRef.current = firstApplied;
    act(() => {
      result.current.startRun();
    });
    const secondApplied = result.current.applyRunToRecord(currentRecordRef.current, diff()).record;
    currentRecordRef.current = secondApplied;

    await act(async () => {
      await result.current.completeRun(firstApplied, { total: 2, patched: 2, errors: [] });
    });

    expect(patchDailyRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        rayenSyncHistory: expect.arrayContaining([
          expect.objectContaining({ id: 'run-1', status: 'complete' }),
          expect.objectContaining({ id: 'run-2', status: 'applied' }),
        ]),
      })
    );
    expect(patchDailyRecord.mock.calls[0][0]).not.toHaveProperty('rayenSync');
  });

  it('keeps applied-stage telemetry when only the persisted event remains at completion', async () => {
    const patchDailyRecord = vi.fn().mockResolvedValue(undefined);
    const currentRecordRef = { current: record() };
    const { result } = renderHook(() =>
      useRayenSyncAudit({
        currentRecordRef,
        patchDailyRecord,
        actor: 'Operador HHR',
        now: () => new Date('2026-07-14T10:00:00.000Z'),
        createId: () => 'persisted-run',
      })
    );

    act(() => {
      result.current.startRun(undefined, {
        stagesMs: { preflight: 25, reconciliation: 300 },
        counters: { requests: 2 },
      });
    });
    const applied = result.current.applyRunToRecord(currentRecordRef.current, diff()).record;
    currentRecordRef.current = applied;
    act(() => result.current.cancelRun());

    await act(async () => {
      await result.current.completeRun(applied, {
        total: 0,
        patched: 0,
        errors: [],
        performance: {
          stagesMs: { clinicalReads: 80 },
          counters: { requests: 1, cacheHits: 0, patches: 0, retries: 0, timeouts: 0 },
        },
      });
    });

    expect(patchDailyRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        rayenSyncHistory: [
          expect.objectContaining({
            performance: {
              stagesMs: { preflight: 25, reconciliation: 300, clinicalReads: 80 },
              counters: {
                requests: 3,
                cacheHits: 0,
                patches: 0,
                retries: 0,
                timeouts: 0,
              },
            },
          }),
        ],
      })
    );
  });

  it('releases an active run when its persisted audit event disappeared', async () => {
    const patchDailyRecord = vi.fn().mockResolvedValue(undefined);
    const currentRecordRef = { current: record() };
    const ids = ['missing-run', 'next-run'];
    const { result } = renderHook(() =>
      useRayenSyncAudit({
        currentRecordRef,
        patchDailyRecord,
        actor: 'Operador HHR',
        createId: () => ids.shift() ?? 'extra-run',
      })
    );

    act(() => {
      result.current.startRun();
    });
    const applied = result.current.applyRunToRecord(currentRecordRef.current, diff()).record;
    const withoutEvent = { ...applied, rayenSyncHistory: [] } as DailyRecord;
    currentRecordRef.current = withoutEvent;

    await act(async () => {
      await result.current.completeRun(withoutEvent, { total: 0, patched: 0, errors: [] });
    });
    const nextApplied = result.current.applyRunToRecord(currentRecordRef.current, diff()).record;

    expect(patchDailyRecord).not.toHaveBeenCalled();
    expect(nextApplied.rayenSync?.runId).toBe('next-run');
  });

  it('does not persist a cancelled preview', async () => {
    const patchDailyRecord = vi.fn().mockResolvedValue(undefined);
    const currentRecordRef = { current: record() };
    const { result } = renderHook(() =>
      useRayenSyncAudit({ currentRecordRef, patchDailyRecord, actor: 'Operador HHR' })
    );

    act(() => {
      result.current.startRun();
      result.current.cancelRun();
    });
    await act(async () => {
      await result.current.failRun('apply_failed');
    });

    expect(patchDailyRecord).not.toHaveBeenCalled();
  });

  it('rehydrates and retries sync metadata after a concurrent Firestore revision', async () => {
    const conflict = new Error('El registro ha sido modificado por otro usuario.');
    conflict.name = 'ConcurrencyError';
    const patchDailyRecord = vi
      .fn()
      .mockResolvedValueOnce({
        result: {
          outcome: 'blocked',
          conflictSummary: { kind: 'concurrency' },
          blockingError: conflict,
        },
      })
      .mockResolvedValueOnce(undefined);
    const freshRecord = {
      ...record(),
      rayenSyncHistory: [
        {
          id: 'other-run',
          startedAt: '2026-07-14T09:30:00.000Z',
          completedAt: '2026-07-14T09:31:00.000Z',
          by: 'Otra estación',
          status: 'complete',
          changes: { admissions: 0, updates: 0, moves: 0, discharges: 0, unchanged: 1 },
        },
      ],
    } as DailyRecord;
    const loadDailyRecord = vi.fn().mockResolvedValue(freshRecord);
    const currentRecordRef = { current: record() };
    const { result } = renderHook(() =>
      useRayenSyncAudit({
        currentRecordRef,
        patchDailyRecord,
        loadDailyRecord,
        actor: 'Operador HHR',
        now: () => new Date('2026-07-14T10:00:00.000Z'),
        createId: () => 'run-1',
      })
    );

    act(() => {
      result.current.startRun();
    });
    await act(async () => {
      await result.current.persistAppliedRun(currentRecordRef.current, diff());
    });

    expect(loadDailyRecord).toHaveBeenCalledWith('2026-07-14');
    expect(patchDailyRecord).toHaveBeenCalledTimes(2);
    expect(patchDailyRecord.mock.calls[1][0].rayenSyncHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'other-run' }),
        expect.objectContaining({ id: 'run-1', status: 'applied' }),
      ])
    );
  });
});
