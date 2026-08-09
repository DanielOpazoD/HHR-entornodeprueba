import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRayenImportCapture } from '@/features/rayen-import/hooks/useRayenImportCapture';
import { INITIAL_RAYEN_IMPORT_STATE } from '@/features/rayen-import/hooks/rayenImportState';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { PreparedRayenSyncContext } from '@/features/rayen-import/hooks/rayenSyncTemporalContext';
import {
  INITIAL_RAYEN_SYNC_EXECUTION_STATE,
  rayenSyncExecutionReducer,
  type RayenSyncExecutionAction,
  type RayenSyncExecutionState,
} from '@/features/rayen-import/hooks/rayenSyncExecutionState';

const bridge = vi.hoisted(() => ({
  subscribeSnapshots: vi.fn(() => vi.fn()),
  subscribeErrors: vi.fn(() => vi.fn()),
}));

vi.mock('@/features/rayen-import/bridge/rayenImportBridge', () => ({
  subscribeToRayenSnapshots: bridge.subscribeSnapshots,
  subscribeToRayenImportErrors: bridge.subscribeErrors,
}));

vi.mock('@/features/rayen-import/hooks/reportDateHelpers', () => ({
  toIsoReportDate: (candidate: DailyRecord) => candidate.date,
  resolveSyncReportRequest: (candidate: DailyRecord) =>
    candidate.date === '2026-07-20'
      ? {
          target: {
            kind: 'unsupported',
            calendarDay: '2026-08-02',
            clinicalDay: '2026-08-02',
            lookbackDays: 13,
          },
          range: { dateStart: candidate.date, dateEnd: candidate.date },
        }
      : {
          target: {
            kind: 'current',
            calendarDay: '2026-08-02',
            clinicalDay: '2026-08-02',
            lookbackDays: 0,
          },
          range: { dateStart: '2026-08-02', dateEnd: '2026-08-02' },
        },
}));

const record = {
  date: '2026-08-02',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2026-08-02T09:00:00.000Z',
  activeExtraBeds: [],
} as DailyRecord;
const policy = { mode: 'preview' as const, clinicalBatchMode: 'enforced' as const, revision: 3 };

describe('useRayenImportCapture', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts one correlated extension request from the freshest selected census', async () => {
    const setState = vi.fn();
    const setStaffingProposal = vi.fn();
    const setStaffingProposalError = vi.fn();
    const startRequest = vi.fn();
    const startRun = vi.fn(() => ({
      id: 'run-1',
      startedAt: '2026-08-02T10:00:00.000Z',
      by: 'Operador HHR',
      sourceDate: '2026-08-02',
    }));
    const recordRunPerformance = vi.fn();
    const getRunId = vi.fn().mockReturnValue('run-1');
    const preparedSyncContextRef: { current: PreparedRayenSyncContext | null } = { current: null };
    const freshRecord = { ...record, lastUpdated: '2026-08-02T09:30:00.000Z' };
    const loadFreshRecord = vi.fn().mockResolvedValue(freshRecord);
    const previewSnapshot = vi.fn();
    const { result } = renderHook(() =>
      useRayenImportCapture({
        currentRecord: record,
        policy,
        policyStatus: 'ready',
        setState,
        setStaffingProposal,
        setStaffingProposalError,
        clearSyncTimeout: vi.fn(),
        syncRequestController: { start: startRequest, cancel: vi.fn(), getRunId },
        preparedSyncContextRef,
        loadFreshRecord,
        startRun,
        failRun: vi.fn().mockResolvedValue(undefined),
        recordRunPerformance,
        previewSnapshot,
      })
    );

    await act(async () => {
      await result.current({ connection: 'ready', report: null, message: 'ok', canSync: true });
    });

    expect(bridge.subscribeSnapshots).toHaveBeenCalledWith(expect.any(Function));
    expect(startRun).toHaveBeenCalledWith(
      { connection: 'ready', report: null, message: 'ok', canSync: true },
      undefined,
      policy
    );
    expect(startRequest).toHaveBeenCalledWith(
      '2026-08-02',
      '2026-08-02',
      'run-1',
      expect.any(Function)
    );
    expect(recordRunPerformance).toHaveBeenCalledWith({ counters: { requests: 1 } }, 'run-1');
    expect(loadFreshRecord).toHaveBeenCalledWith('2026-08-02');
    expect(preparedSyncContextRef.current).toEqual(
      expect.objectContaining({
        record: freshRecord,
        target: expect.objectContaining({ clinicalDay: '2026-08-02' }),
      })
    );
    const stateUpdater = setState.mock.calls.at(-1)?.[0] as (
      state: typeof INITIAL_RAYEN_IMPORT_STATE
    ) => typeof INITIAL_RAYEN_IMPORT_STATE;
    expect(stateUpdater(INITIAL_RAYEN_IMPORT_STATE)).toEqual(
      expect.objectContaining({ isSyncing: true, error: null })
    );

    const [onSnapshot] = bridge.subscribeSnapshots.mock.calls[0] as unknown as [
      (snapshot: unknown, bundle: unknown, requestId: string) => void,
    ];
    act(() => onSnapshot('snapshot', 'bundle', 'request-1'));
    expect(getRunId).toHaveBeenCalledWith('request-1');
    expect(previewSnapshot).toHaveBeenCalledWith('snapshot', 'bundle', 'run-1', 'request-1');
  });

  it('ignores a second start while the freshest census is still loading', async () => {
    let resolveFreshRecord!: (value: DailyRecord) => void;
    const loadFreshRecord = vi.fn(
      () => new Promise<DailyRecord>(resolve => (resolveFreshRecord = resolve))
    );
    const startRun = vi.fn(() => ({
      id: 'run-1',
      startedAt: '2026-08-02T10:00:00.000Z',
      by: 'Operador HHR',
      sourceDate: '2026-08-02',
    }));
    const startRequest = vi.fn();
    const { result } = renderHook(() =>
      useRayenImportCapture({
        currentRecord: record,
        policy,
        policyStatus: 'ready',
        setState: vi.fn(),
        setStaffingProposal: vi.fn(),
        setStaffingProposalError: vi.fn(),
        clearSyncTimeout: vi.fn(),
        syncRequestController: {
          start: startRequest,
          cancel: vi.fn(),
          getRunId: vi.fn().mockReturnValue('run-1'),
        },
        preparedSyncContextRef: { current: null },
        loadFreshRecord,
        startRun,
        failRun: vi.fn().mockResolvedValue(undefined),
        recordRunPerformance: vi.fn(),
        previewSnapshot: vi.fn(),
      })
    );

    let firstStart!: Promise<void>;
    await act(async () => {
      firstStart = result.current({
        connection: 'ready',
        report: null,
        message: 'ok',
        canSync: true,
      });
      await result.current({ connection: 'ready', report: null, message: 'ok', canSync: true });
    });
    resolveFreshRecord(record);
    await act(async () => firstStart);

    expect(startRun).toHaveBeenCalledOnce();
    expect(loadFreshRecord).toHaveBeenCalledOnce();
    expect(startRequest).toHaveBeenCalledOnce();
  });

  it('does not supersede an active correlated capture on a repeated click', async () => {
    const activeContext = {
      runId: 'run-active',
      requestId: 'request-active',
      selectedDate: record.date,
      clinicalDay: record.date,
      timeZone: 'Pacific/Easter' as const,
      target: 'current' as const,
      lookbackDays: 0,
      baseRevision: record.lastUpdated,
      policy,
      policyRevision: policy.revision,
      queryRange: { dateStart: record.date, dateEnd: record.date },
      preparedAt: '2026-08-02T10:00:00.000Z',
    };
    const executionRef: { current: RayenSyncExecutionState } = {
      current: rayenSyncExecutionReducer(
        rayenSyncExecutionReducer(INITIAL_RAYEN_SYNC_EXECUTION_STATE, {
          type: 'prepare',
          runId: activeContext.runId,
          selectedDate: activeContext.selectedDate,
        }),
        { type: 'activate', context: activeContext }
      ),
    };
    const startRun = vi.fn();
    const startRequest = vi.fn();
    const { result } = renderHook(() =>
      useRayenImportCapture({
        currentRecord: record,
        policy,
        policyStatus: 'ready',
        dispatchExecution: vi.fn(),
        executionRef,
        setState: vi.fn(),
        setStaffingProposal: vi.fn(),
        setStaffingProposalError: vi.fn(),
        clearSyncTimeout: vi.fn(),
        syncRequestController: {
          start: startRequest,
          cancel: vi.fn(),
          getRunId: vi.fn().mockReturnValue(activeContext.runId),
        },
        preparedSyncContextRef: { current: null },
        loadFreshRecord: vi.fn().mockResolvedValue(record),
        startRun,
        failRun: vi.fn().mockResolvedValue(undefined),
        recordRunPerformance: vi.fn(),
        previewSnapshot: vi.fn(),
      })
    );

    await act(async () => {
      await result.current({ connection: 'ready', report: null, message: 'ok', canSync: true });
    });

    expect(startRun).not.toHaveBeenCalled();
    expect(startRequest).not.toHaveBeenCalled();
    expect(executionRef.current.context?.runId).toBe(activeContext.runId);
    expect(executionRef.current.stage).toEqual({ type: 'capturing' });
  });

  it('does not start an obsolete extension request when the execution is cancelled while loading', async () => {
    let resolveFreshRecord!: (value: DailyRecord) => void;
    const loadFreshRecord = vi.fn(
      () => new Promise<DailyRecord>(resolve => (resolveFreshRecord = resolve))
    );
    const startRequest = vi.fn();
    const executionRef: { current: RayenSyncExecutionState } = {
      current: INITIAL_RAYEN_SYNC_EXECUTION_STATE,
    };
    const dispatchExecution = vi.fn((action: RayenSyncExecutionAction) => {
      executionRef.current = rayenSyncExecutionReducer(executionRef.current, action);
    });
    const preparedSyncContextRef: { current: PreparedRayenSyncContext | null } = { current: null };
    const failRun = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useRayenImportCapture({
        currentRecord: record,
        policy,
        policyStatus: 'ready',
        dispatchExecution,
        executionRef,
        setState: vi.fn(),
        setStaffingProposal: vi.fn(),
        setStaffingProposalError: vi.fn(),
        clearSyncTimeout: vi.fn(),
        syncRequestController: {
          start: startRequest,
          cancel: vi.fn(),
          getRunId: vi.fn().mockReturnValue('run-1'),
        },
        preparedSyncContextRef,
        loadFreshRecord,
        startRun: vi.fn(() => ({
          id: 'run-1',
          startedAt: '2026-08-02T10:00:00.000Z',
          by: 'Operador HHR',
          sourceDate: '2026-08-02',
        })),
        failRun,
        recordRunPerformance: vi.fn(),
        previewSnapshot: vi.fn(),
      })
    );

    let pendingStart!: Promise<void>;
    await act(async () => {
      pendingStart = result.current({
        connection: 'ready',
        report: null,
        message: 'ok',
        canSync: true,
      });
      await Promise.resolve();
    });
    act(() => dispatchExecution({ type: 'cancel', runId: 'run-1' }));
    resolveFreshRecord(record);
    await act(async () => pendingStart);

    expect(executionRef.current.stage).toEqual({ type: 'cancelled' });
    expect(startRequest).not.toHaveBeenCalled();
    expect(preparedSyncContextRef.current).toBeNull();
    expect(failRun).not.toHaveBeenCalled();
  });

  it('terminalizes the run when the freshest census cannot be loaded', async () => {
    const failRun = vi.fn().mockResolvedValue(undefined);
    const setState = vi.fn();
    const startRequest = vi.fn();
    const { result } = renderHook(() =>
      useRayenImportCapture({
        currentRecord: record,
        policy,
        policyStatus: 'ready',
        setState,
        setStaffingProposal: vi.fn(),
        setStaffingProposalError: vi.fn(),
        clearSyncTimeout: vi.fn(),
        syncRequestController: {
          start: startRequest,
          cancel: vi.fn(),
          getRunId: vi.fn().mockReturnValue('run-1'),
        },
        preparedSyncContextRef: { current: null },
        loadFreshRecord: vi.fn().mockRejectedValue(new Error('lectura fallida')),
        startRun: vi.fn(() => ({
          id: 'run-1',
          startedAt: '2026-08-02T10:00:00.000Z',
          by: 'Operador HHR',
          sourceDate: '2026-08-02',
        })),
        failRun,
        recordRunPerformance: vi.fn(),
        previewSnapshot: vi.fn(),
      })
    );

    await act(async () => {
      await result.current({ connection: 'ready', report: null, message: 'ok', canSync: true });
    });

    expect(startRequest).not.toHaveBeenCalled();
    expect(failRun).toHaveBeenCalledWith('snapshot_error', 'run-1');
    const stateUpdater = setState.mock.calls.at(-1)?.[0] as (
      state: typeof INITIAL_RAYEN_IMPORT_STATE
    ) => typeof INITIAL_RAYEN_IMPORT_STATE;
    expect(stateUpdater(INITIAL_RAYEN_IMPORT_STATE)).toEqual(
      expect.objectContaining({ isSyncing: false, error: 'lectura fallida' })
    );
  });

  it('rejects a target older than D-7 before starting an extension request', async () => {
    const unsupportedRecord = { ...record, date: '2026-07-20' };
    const failRun = vi.fn().mockResolvedValue(undefined);
    const setState = vi.fn();
    const startRequest = vi.fn();
    const { result } = renderHook(() =>
      useRayenImportCapture({
        currentRecord: unsupportedRecord,
        policy,
        policyStatus: 'ready',
        setState,
        setStaffingProposal: vi.fn(),
        setStaffingProposalError: vi.fn(),
        clearSyncTimeout: vi.fn(),
        syncRequestController: {
          start: startRequest,
          cancel: vi.fn(),
          getRunId: vi.fn().mockReturnValue('run-unsupported'),
        },
        preparedSyncContextRef: { current: null },
        loadFreshRecord: vi.fn().mockResolvedValue(unsupportedRecord),
        startRun: vi.fn(() => ({
          id: 'run-unsupported',
          startedAt: '2026-08-02T10:00:00.000Z',
          by: 'Operador HHR',
          sourceDate: unsupportedRecord.date,
        })),
        failRun,
        recordRunPerformance: vi.fn(),
        previewSnapshot: vi.fn(),
      })
    );

    await act(async () => {
      await result.current({ connection: 'ready', report: null, message: 'ok', canSync: true });
    });

    expect(startRequest).not.toHaveBeenCalled();
    expect(failRun).toHaveBeenCalledWith('snapshot_error', 'run-unsupported');
    const stateUpdater = setState.mock.calls.at(-1)?.[0] as (
      state: typeof INITIAL_RAYEN_IMPORT_STATE
    ) => typeof INITIAL_RAYEN_IMPORT_STATE;
    expect(stateUpdater(INITIAL_RAYEN_IMPORT_STATE)).toEqual(
      expect.objectContaining({
        isSyncing: false,
        error: expect.stringContaining('siete días anteriores'),
      })
    );
  });

  it('terminalizes the correlated run when its extension request times out', async () => {
    const setState = vi.fn();
    const startRequest = vi.fn();
    const failRun = vi.fn().mockResolvedValue(undefined);
    const recordRunPerformance = vi.fn();
    const preparedSyncContextRef: { current: PreparedRayenSyncContext | null } = { current: null };
    const { result } = renderHook(() =>
      useRayenImportCapture({
        currentRecord: record,
        policy,
        policyStatus: 'ready',
        setState,
        setStaffingProposal: vi.fn(),
        setStaffingProposalError: vi.fn(),
        clearSyncTimeout: vi.fn(),
        syncRequestController: {
          start: startRequest,
          cancel: vi.fn(),
          getRunId: vi.fn().mockReturnValue('run-1'),
        },
        preparedSyncContextRef,
        loadFreshRecord: vi.fn().mockResolvedValue(record),
        startRun: vi.fn(() => ({
          id: 'run-1',
          startedAt: '2026-08-02T10:00:00.000Z',
          by: 'Operador HHR',
          sourceDate: '2026-08-02',
        })),
        failRun,
        recordRunPerformance,
        previewSnapshot: vi.fn(),
      })
    );

    await act(async () => {
      await result.current({ connection: 'ready', report: null, message: 'ok', canSync: true });
    });
    const onTimeout = startRequest.mock.calls[0]?.[3] as () => void;

    act(() => onTimeout());

    expect(preparedSyncContextRef.current).toBeNull();
    expect(recordRunPerformance).toHaveBeenCalledWith({ counters: { timeouts: 1 } }, 'run-1');
    expect(failRun).toHaveBeenCalledWith('snapshot_timeout', 'run-1');
    const stateUpdater = setState.mock.calls.at(-1)?.[0] as (
      state: typeof INITIAL_RAYEN_IMPORT_STATE
    ) => typeof INITIAL_RAYEN_IMPORT_STATE;
    expect(stateUpdater({ ...INITIAL_RAYEN_IMPORT_STATE, isSyncing: true })).toEqual(
      expect.objectContaining({ isSyncing: false, error: expect.any(String) })
    );
  });

});
