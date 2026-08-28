import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { useRayenCensusDiffApplication } from '@/features/rayen-import/hooks/useRayenCensusDiffApplication';
import { QueryClient } from '@tanstack/react-query';

const queryClient = new QueryClient();

const baseRecord = {
  date: '2026-08-07',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: '2026-08-07T23:00:00.000Z',
} as DailyRecord;

const diff = {
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
} as CensusImportDiff;

describe('useRayenCensusDiffApplication', () => {
  it('persists a historical census with the revision of its base, not its new timestamp', async () => {
    const run = {
      id: 'run-x-minus-one',
      startedAt: '2026-08-08T01:00:00.000Z',
      by: 'Operador HHR',
      sourceDate: '2026-08-07',
    };
    const saveDailyRecord = vi.fn(async (record: DailyRecord, _expectedLastUpdated: string) => ({
      record,
      result: {
        date: record.date,
        outcome: 'clean',
        confirmedRecord: record,
      },
    }));
    const applyRunToRecord = vi.fn((record: DailyRecord) => ({
      record: {
        ...record,
        rayenSync: {
          at: run.startedAt,
          by: run.by,
          runId: run.id,
          status: 'applied',
        },
        rayenSyncHistory: [
          {
            id: run.id,
            sourceDate: run.sourceDate,
            startedAt: run.startedAt,
            completedAt: '2026-08-08T01:00:05.000Z',
            by: run.by,
            status: 'applied',
            policy: { mode: 'preview', revision: 1, clinicalBatchMode: 'enforced' },
          },
        ],
      } as DailyRecord,
    }));
    const { result } = renderHook(() =>
      useRayenCensusDiffApplication({
        ensureRun: () => run as never,
        applyRunToRecord,
        saveDailyRecord: saveDailyRecord as never,
        checkpointRepository: { updatePartialDetailed: vi.fn() as never },
        queryClient,
        loadAuthoritativeRecord: vi.fn().mockResolvedValue(baseRecord),
        loadLocalRecord: vi.fn().mockResolvedValue({
          record: null,
          hasPendingWrites: true,
          hasPendingWritesForDate: true,
          writeState: 'active',
        }),
        recordRunPerformance: vi.fn(),
      })
    );

    await act(async () => {
      await result.current(baseRecord, diff);
    });

    const [savedRecord, expectedLastUpdated] = saveDailyRecord.mock.calls[0];
    expect(savedRecord.lastUpdated).not.toBe(baseRecord.lastUpdated);
    expect(expectedLastUpdated).toBe(baseRecord.lastUpdated);
  });

  it('hands the server-confirmed revision to the clinical stage in the same execution', async () => {
    const run = {
      id: 'run-first-pass-clinical',
      startedAt: '2026-08-08T01:00:00.000Z',
      by: 'Operador HHR',
      sourceDate: baseRecord.date,
    };
    const confirmedAt = '2026-08-08T01:00:05.000Z';
    const applyRunToRecord = vi.fn((record: DailyRecord) => ({
      record: {
        ...record,
        rayenSync: {
          at: run.startedAt,
          by: run.by,
          runId: run.id,
          status: 'applied',
        },
        rayenSyncHistory: [
          {
            id: run.id,
            sourceDate: run.sourceDate,
            startedAt: run.startedAt,
            completedAt: confirmedAt,
            by: run.by,
            status: 'applied',
            policy: { mode: 'preview', revision: 1, clinicalBatchMode: 'enforced' },
          },
        ],
      } as DailyRecord,
    }));
    const saveDailyRecord = vi.fn();
    const checkpointDailyRecord = vi.fn(async (_date: string, patch: object) => {
      const base = baseRecord;
      const confirmedRecord = { ...base, lastUpdated: confirmedAt } as DailyRecord;
      Object.assign(confirmedRecord, patch);
      return {
        date: confirmedRecord.date,
        outcome: 'clean',
        updatedRemotely: true,
        confirmedRecord,
      };
    });
    const { result } = renderHook(() =>
      useRayenCensusDiffApplication({
        ensureRun: () => run as never,
        applyRunToRecord,
        saveDailyRecord: saveDailyRecord as never,
        checkpointRepository: { updatePartialDetailed: checkpointDailyRecord as never },
        queryClient,
        loadAuthoritativeRecord: vi.fn().mockResolvedValue(baseRecord),
        loadLocalRecord: vi.fn().mockResolvedValue({
          record: null,
          hasPendingWrites: false,
          hasPendingWritesForDate: false,
          writeState: 'none',
        }),
        recordRunPerformance: vi.fn(),
      })
    );

    let applied: Awaited<ReturnType<typeof result.current>> | undefined;
    await act(async () => {
      applied = await result.current(baseRecord, diff);
    });

    expect(applied?.record.lastUpdated).toBe(confirmedAt);
    expect(applied?.confirmedHandoff.acceptedRevision).toBe(confirmedAt);
    expect(applied?.confirmedHandoff.record).toBe(applied?.record);
    expect(applied?.structuralStage.status).toBe('confirmed');
    expect(checkpointDailyRecord).toHaveBeenCalledTimes(1);
    expect(saveDailyRecord).not.toHaveBeenCalled();
  });

  it('rebases a metadata checkpoint on the latest server revision and preserves newer audit history', async () => {
    const run = {
      id: 'run-rebased-checkpoint',
      startedAt: '2026-08-08T01:00:00.000Z',
      by: 'Operador HHR',
      sourceDate: baseRecord.date,
    };
    const priorEvent = {
      id: 'run-prior-failure',
      sourceDate: baseRecord.date,
      startedAt: '2026-08-08T00:55:00.000Z',
      completedAt: '2026-08-08T00:55:04.000Z',
      by: run.by,
      status: 'failed',
      policy: { mode: 'preview', revision: 1, clinicalBatchMode: 'enforced' },
    };
    const authoritativeRecord = {
      ...baseRecord,
      lastUpdated: '2026-08-08T00:55:04.000Z',
      rayenSyncHistory: [priorEvent],
    } as DailyRecord;
    const applyRunToRecord = vi.fn((record: DailyRecord) => ({
      record: {
        ...record,
        rayenSync: {
          at: run.startedAt,
          by: run.by,
          runId: run.id,
          status: 'applied',
        },
        rayenSyncHistory: [
          ...(record.rayenSyncHistory ?? []),
          {
            id: run.id,
            sourceDate: run.sourceDate,
            startedAt: run.startedAt,
            completedAt: '2026-08-08T01:00:04.000Z',
            by: run.by,
            status: 'applied',
            policy: { mode: 'preview', revision: 1, clinicalBatchMode: 'enforced' },
          },
        ],
      } as DailyRecord,
    }));
    const checkpointDailyRecord = vi.fn(
      async (_date: string, patch: object, options: { baseRecord: DailyRecord }) => ({
        date: baseRecord.date,
        outcome: 'clean',
        updatedRemotely: true,
        confirmedRecord: {
          ...options.baseRecord,
          ...patch,
          lastUpdated: '2026-08-08T01:00:05.000Z',
        } as DailyRecord,
      })
    );
    const { result } = renderHook(() =>
      useRayenCensusDiffApplication({
        ensureRun: () => run as never,
        applyRunToRecord,
        saveDailyRecord: vi.fn() as never,
        checkpointRepository: { updatePartialDetailed: checkpointDailyRecord as never },
        queryClient,
        loadAuthoritativeRecord: vi.fn().mockResolvedValue(authoritativeRecord),
        loadLocalRecord: vi.fn().mockResolvedValue({
          record: baseRecord,
          hasPendingWrites: false,
          hasPendingWritesForDate: false,
          writeState: 'none',
        }),
        recordRunPerformance: vi.fn(),
      })
    );

    await act(async () => {
      await result.current(baseRecord, diff);
    });

    const [, patch, options] = checkpointDailyRecord.mock.calls[0];
    expect(options.baseRecord).toBe(authoritativeRecord);
    expect((patch as { rayenSyncHistory: unknown[] }).rayenSyncHistory).toEqual([
      priorEvent,
      expect.objectContaining({ id: run.id, status: 'applied' }),
    ]);
  });

  it('rejects a metadata checkpoint when the authoritative structure changed after planning', async () => {
    const changedRemote = {
      ...baseRecord,
      beds: { R1: { id: 'R1', name: 'R1', status: 'available' } },
      lastUpdated: '2026-08-08T00:59:00.000Z',
    } as unknown as DailyRecord;
    const checkpointDailyRecord = vi.fn();
    const { result } = renderHook(() =>
      useRayenCensusDiffApplication({
        ensureRun: () =>
          ({
            id: 'run-stale-plan',
            startedAt: '2026-08-08T01:00:00.000Z',
            by: 'Operador HHR',
            sourceDate: baseRecord.date,
          }) as never,
        applyRunToRecord: record => ({ record }),
        saveDailyRecord: vi.fn() as never,
        checkpointRepository: { updatePartialDetailed: checkpointDailyRecord as never },
        queryClient,
        loadAuthoritativeRecord: vi.fn().mockResolvedValue(changedRemote),
        loadLocalRecord: vi.fn().mockResolvedValue({
          record: baseRecord,
          hasPendingWrites: false,
          hasPendingWritesForDate: false,
          writeState: 'none',
        }),
        recordRunPerformance: vi.fn(),
      })
    );

    let rejection: unknown;
    await act(async () => {
      try {
        await result.current(baseRecord, diff);
      } catch (error) {
        rejection = error;
      }
    });

    expect(rejection).toMatchObject({ name: 'ConcurrencyError' });
    expect(checkpointDailyRecord).not.toHaveBeenCalled();
  });

  it('keeps the full structural save when a local write remains queued', async () => {
    const run = {
      id: 'run-pending-local',
      startedAt: '2026-08-08T01:00:00.000Z',
      by: 'Operador HHR',
      sourceDate: baseRecord.date,
    };
    const stamped = {
      ...baseRecord,
      rayenSync: {
        at: run.startedAt,
        by: run.by,
        runId: run.id,
        status: 'applied',
      },
      rayenSyncHistory: [
        {
          id: run.id,
          sourceDate: run.sourceDate,
          startedAt: run.startedAt,
          by: run.by,
          status: 'applied',
          policy: { mode: 'preview', revision: 1, clinicalBatchMode: 'enforced' },
        },
      ],
    } as DailyRecord;
    const saveDailyRecord = vi.fn(async () => ({
      record: stamped,
      result: { date: stamped.date, outcome: 'clean', confirmedRecord: stamped },
    }));
    const checkpointDailyRecord = vi.fn();
    const { result } = renderHook(() =>
      useRayenCensusDiffApplication({
        ensureRun: () => run as never,
        applyRunToRecord: () => ({ record: stamped }),
        saveDailyRecord: saveDailyRecord as never,
        checkpointRepository: { updatePartialDetailed: checkpointDailyRecord as never },
        queryClient,
        loadAuthoritativeRecord: vi.fn().mockResolvedValue(baseRecord),
        loadLocalRecord: vi.fn().mockResolvedValue({
          record: baseRecord,
          hasPendingWrites: true,
          hasPendingWritesForDate: true,
          writeState: 'none',
        }),
        recordRunPerformance: vi.fn(),
      })
    );

    await act(async () => {
      await result.current(baseRecord, diff);
    });

    expect(saveDailyRecord).toHaveBeenCalledTimes(1);
    expect(checkpointDailyRecord).not.toHaveBeenCalled();
  });

  it('keeps the full save when another revision for the date remains queued', async () => {
    const run = {
      id: 'run-date-pending',
      startedAt: '2026-08-08T01:00:00.000Z',
      by: 'Operador HHR',
      sourceDate: baseRecord.date,
    };
    const stamped = {
      ...baseRecord,
      rayenSync: {
        at: run.startedAt,
        by: run.by,
        runId: run.id,
        status: 'applied',
      },
      rayenSyncHistory: [
        {
          id: run.id,
          sourceDate: run.sourceDate,
          startedAt: run.startedAt,
          by: run.by,
          status: 'applied',
          policy: { mode: 'preview', revision: 1, clinicalBatchMode: 'enforced' },
        },
      ],
    } as DailyRecord;
    const saveDailyRecord = vi.fn(async (record: DailyRecord) => ({
      record,
      result: { date: record.date, outcome: 'clean', confirmedRecord: record },
    }));
    const checkpointDailyRecord = vi.fn();
    const { result } = renderHook(() =>
      useRayenCensusDiffApplication({
        ensureRun: () => run as never,
        applyRunToRecord: () => ({ record: stamped }),
        saveDailyRecord: saveDailyRecord as never,
        checkpointRepository: { updatePartialDetailed: checkpointDailyRecord as never },
        queryClient,
        loadAuthoritativeRecord: vi.fn().mockResolvedValue(baseRecord),
        loadLocalRecord: vi.fn().mockResolvedValue({
          record: baseRecord,
          hasPendingWrites: false,
          hasPendingWritesForDate: true,
          writeState: 'none',
        }),
        recordRunPerformance: vi.fn(),
      })
    );

    await act(async () => {
      await result.current(baseRecord, diff);
    });

    expect(saveDailyRecord).toHaveBeenCalledTimes(1);
    expect(checkpointDailyRecord).not.toHaveBeenCalled();
  });
});
