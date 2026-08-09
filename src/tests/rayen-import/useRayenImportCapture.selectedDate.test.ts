import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRayenImportCapture } from '@/features/rayen-import/hooks/useRayenImportCapture';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { PreparedRayenSyncContext } from '@/features/rayen-import/hooks/rayenSyncTemporalContext';
import {
  INITIAL_RAYEN_SYNC_EXECUTION_STATE,
  rayenSyncExecutionReducer,
  type RayenSyncExecutionAction,
  type RayenSyncExecutionState,
} from '@/features/rayen-import/hooks/rayenSyncExecutionState';

vi.mock('@/features/rayen-import/bridge/rayenImportBridge', () => ({
  subscribeToRayenSnapshots: vi.fn(() => vi.fn()),
  subscribeToRayenImportErrors: vi.fn(() => vi.fn()),
}));

vi.mock('@/features/rayen-import/hooks/reportDateHelpers', () => ({
  toIsoReportDate: (candidate: DailyRecord) => candidate.date,
  resolveSyncReportRequest: (candidate: DailyRecord) => ({
    target: {
      kind: 'historical',
      calendarDay: candidate.date,
      clinicalDay: candidate.date,
      lookbackDays: 1,
    },
    range: { dateStart: candidate.date, dateEnd: candidate.date },
  }),
}));

const oldRecord = {
  date: '2026-08-02',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2026-08-02T09:00:00.000Z',
  activeExtraBeds: [],
} as DailyRecord;
const newRecord = {
  ...oldRecord,
  date: '2026-08-03',
  lastUpdated: '2026-08-03T09:00:00.000Z',
} as DailyRecord;
const policy = { mode: 'preview' as const, clinicalBatchMode: 'enforced' as const, revision: 3 };

describe('useRayenImportCapture selected-date supersession', () => {
  it('starts the newly selected date while an obsolete date is still loading', async () => {
    let resolveOldRecord!: (value: DailyRecord) => void;
    const loadFreshRecord = vi.fn((date: string) =>
      date === oldRecord.date
        ? new Promise<DailyRecord>(resolve => (resolveOldRecord = resolve))
        : Promise.resolve(newRecord)
    );
    const startRun = vi
      .fn()
      .mockReturnValueOnce({
        id: 'run-old',
        startedAt: '2026-08-02T10:00:00.000Z',
        by: 'Operador HHR',
        sourceDate: oldRecord.date,
      })
      .mockReturnValueOnce({
        id: 'run-new',
        startedAt: '2026-08-03T10:00:00.000Z',
        by: 'Operador HHR',
        sourceDate: newRecord.date,
      });
    const startRequest = vi.fn().mockReturnValue('request-new');
    const executionRef: { current: RayenSyncExecutionState } = {
      current: INITIAL_RAYEN_SYNC_EXECUTION_STATE,
    };
    const dispatchExecution = vi.fn((action: RayenSyncExecutionAction) => {
      executionRef.current = rayenSyncExecutionReducer(executionRef.current, action);
    });
    const preparedSyncContextRef: { current: PreparedRayenSyncContext | null } = { current: null };
    const cancelRun = vi.fn();
    const clearSyncTimeout = vi.fn();
    const commonInput = {
      policy,
      policyStatus: 'ready' as const,
      dispatchExecution,
      executionRef,
      setState: vi.fn(),
      setStaffingProposal: vi.fn(),
      setStaffingProposalError: vi.fn(),
      clearSyncTimeout,
      syncRequestController: {
        start: startRequest,
        cancel: vi.fn(),
        getRunId: vi.fn().mockReturnValue('run-new'),
      },
      preparedSyncContextRef,
      loadFreshRecord,
      startRun,
      failRun: vi.fn().mockResolvedValue(undefined),
      cancelRun,
      recordRunPerformance: vi.fn(),
      previewSnapshot: vi.fn(),
    };
    const { result, rerender } = renderHook(
      ({ currentRecord }: { currentRecord: DailyRecord }) =>
        useRayenImportCapture({ currentRecord, ...commonInput }),
      { initialProps: { currentRecord: oldRecord } }
    );

    let oldStart!: Promise<void>;
    await act(async () => {
      oldStart = result.current({
        connection: 'ready',
        report: null,
        message: 'ok',
        canSync: true,
      });
      await Promise.resolve();
    });

    rerender({ currentRecord: newRecord });
    await act(async () => {
      await result.current({ connection: 'ready', report: null, message: 'ok', canSync: true });
    });

    expect(startRequest).toHaveBeenCalledOnce();
    expect(startRequest).toHaveBeenCalledWith(
      newRecord.date,
      newRecord.date,
      'run-new',
      expect.any(Function)
    );
    expect(executionRef.current.context?.runId).toBe('run-new');
    expect(executionRef.current.context?.selectedDate).toBe(newRecord.date);
    expect(cancelRun).toHaveBeenCalledOnce();
    expect(clearSyncTimeout).toHaveBeenCalled();

    resolveOldRecord(oldRecord);
    await act(async () => oldStart);

    expect(startRequest).toHaveBeenCalledOnce();
    expect(executionRef.current.context?.runId).toBe('run-new');
  });
});
