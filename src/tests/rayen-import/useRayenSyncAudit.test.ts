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
      result.current.startRun();
    });
    const stamped = result.current.applyRunToRecord(currentRecordRef.current, diff()).record;
    currentRecordRef.current = stamped;
    await act(async () => {
      await result.current.completeRun(stamped, { total: 2, patched: 1, errors: [] });
    });

    expect(stamped.rayenSyncHistory).toHaveLength(1);
    expect(patchDailyRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        rayenSync: expect.objectContaining({ runId: 'run-1', status: 'complete' }),
        rayenSyncHistory: [
          expect.objectContaining({
            id: 'run-1',
            status: 'complete',
            coverage: expect.any(Object),
          }),
        ],
      })
    );
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
});
