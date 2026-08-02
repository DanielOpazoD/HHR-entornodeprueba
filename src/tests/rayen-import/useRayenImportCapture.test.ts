import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRayenImportCapture } from '@/features/rayen-import/hooks/useRayenImportCapture';
import { INITIAL_RAYEN_IMPORT_STATE } from '@/features/rayen-import/hooks/rayenImportState';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { CensusSyncTarget } from '@/features/rayen-import/domain/historicalCensusSync';

const bridge = vi.hoisted(() => ({
  subscribeSnapshots: vi.fn(() => vi.fn()),
  subscribeErrors: vi.fn(() => vi.fn()),
}));

vi.mock('@/features/rayen-import/bridge/rayenImportBridge', () => ({
  subscribeToRayenSnapshots: bridge.subscribeSnapshots,
  subscribeToRayenImportErrors: bridge.subscribeErrors,
}));

vi.mock('@/features/rayen-import/hooks/reportDateHelpers', () => ({
  resolveSyncReportRequest: () => ({
    target: {
      kind: 'current',
      calendarDay: '2026-08-02',
      clinicalDay: '2026-08-02',
      lookbackDays: 0,
    },
    range: { dateStart: '2026-08-02', dateEnd: '2026-08-02' },
  }),
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

describe('useRayenImportCapture', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts one correlated extension request and records its aggregate request counter', () => {
    const setState = vi.fn();
    const setStaffingProposal = vi.fn();
    const setStaffingProposalError = vi.fn();
    const startRequest = vi.fn();
    const startRun = vi.fn(() => ({
      id: 'run-1',
      startedAt: '2026-08-02T10:00:00.000Z',
      by: 'Operador HHR',
    }));
    const recordRunPerformance = vi.fn();
    const getRunId = vi.fn().mockReturnValue('run-1');
    const syncTargetRef: { current: CensusSyncTarget | null } = { current: null };
    const previewSnapshot = vi.fn();
    const { result } = renderHook(() =>
      useRayenImportCapture({
        currentRecord: record,
        setState,
        setStaffingProposal,
        setStaffingProposalError,
        clearSyncTimeout: vi.fn(),
        syncRequestController: { start: startRequest, cancel: vi.fn(), getRunId },
        syncTargetRef,
        startRun,
        failRun: vi.fn().mockResolvedValue(undefined),
        recordRunPerformance,
        previewSnapshot,
      })
    );

    act(() => {
      result.current({ connection: 'ready', report: null, message: 'ok', canSync: true });
    });

    expect(bridge.subscribeSnapshots).toHaveBeenCalledWith(expect.any(Function));
    expect(startRequest).toHaveBeenCalledWith(
      '2026-08-02',
      '2026-08-02',
      'run-1',
      expect.any(Function)
    );
    expect(recordRunPerformance).toHaveBeenCalledWith({ counters: { requests: 1 } }, 'run-1');
    expect(syncTargetRef.current).toEqual(expect.objectContaining({ clinicalDay: '2026-08-02' }));
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
    expect(previewSnapshot).toHaveBeenCalledWith('snapshot', 'bundle', 'run-1');
  });

  it('terminalizes the correlated run when its extension request times out', () => {
    const setState = vi.fn();
    const startRequest = vi.fn();
    const failRun = vi.fn().mockResolvedValue(undefined);
    const recordRunPerformance = vi.fn();
    const syncTargetRef: { current: CensusSyncTarget | null } = { current: null };
    const { result } = renderHook(() =>
      useRayenImportCapture({
        currentRecord: record,
        setState,
        setStaffingProposal: vi.fn(),
        setStaffingProposalError: vi.fn(),
        clearSyncTimeout: vi.fn(),
        syncRequestController: {
          start: startRequest,
          cancel: vi.fn(),
          getRunId: vi.fn().mockReturnValue('run-1'),
        },
        syncTargetRef,
        startRun: vi.fn(() => ({
          id: 'run-1',
          startedAt: '2026-08-02T10:00:00.000Z',
          by: 'Operador HHR',
        })),
        failRun,
        recordRunPerformance,
        previewSnapshot: vi.fn(),
      })
    );

    act(() => {
      result.current({ connection: 'ready', report: null, message: 'ok', canSync: true });
    });
    const onTimeout = startRequest.mock.calls[0]?.[3] as () => void;

    act(() => onTimeout());

    expect(syncTargetRef.current).toBeNull();
    expect(recordRunPerformance).toHaveBeenCalledWith({ counters: { timeouts: 1 } }, 'run-1');
    expect(failRun).toHaveBeenCalledWith('snapshot_timeout', 'run-1');
    const stateUpdater = setState.mock.calls.at(-1)?.[0] as (
      state: typeof INITIAL_RAYEN_IMPORT_STATE
    ) => typeof INITIAL_RAYEN_IMPORT_STATE;
    expect(stateUpdater({ ...INITIAL_RAYEN_IMPORT_STATE, isSyncing: true })).toEqual(
      expect.objectContaining({ isSyncing: false, error: expect.any(String) })
    );
  });

  it('closes the request and terminalizes the active run when the extension reports an error', () => {
    const clearSyncTimeout = vi.fn();
    const failRun = vi.fn().mockResolvedValue(undefined);
    const setState = vi.fn();
    const getRunId = vi.fn().mockReturnValue('run-1');
    const syncTargetRef: { current: CensusSyncTarget | null } = {
      current: {
        kind: 'current' as const,
        calendarDay: '2026-08-02',
        clinicalDay: '2026-08-02',
        lookbackDays: 0,
      },
    };
    renderHook(() =>
      useRayenImportCapture({
        currentRecord: record,
        setState,
        setStaffingProposal: vi.fn(),
        setStaffingProposalError: vi.fn(),
        clearSyncTimeout,
        syncRequestController: { start: vi.fn(), cancel: vi.fn(), getRunId },
        syncTargetRef,
        startRun: vi.fn(() => ({
          id: 'unused-run',
          startedAt: '2026-08-02T10:00:00.000Z',
          by: 'Operador HHR',
        })),
        failRun,
        recordRunPerformance: vi.fn(),
        previewSnapshot: vi.fn(),
      })
    );

    const [onError] = bridge.subscribeErrors.mock.calls[0] as unknown as [
      (error: string, requestId: string) => void,
    ];
    act(() => onError('capture failed', 'request-1'));

    expect(clearSyncTimeout).toHaveBeenCalledOnce();
    expect(syncTargetRef.current).toBeNull();
    expect(failRun).toHaveBeenCalledWith('snapshot_error', 'run-1');
    const stateUpdater = setState.mock.calls[0]?.[0] as (
      state: typeof INITIAL_RAYEN_IMPORT_STATE
    ) => typeof INITIAL_RAYEN_IMPORT_STATE;
    expect(stateUpdater(INITIAL_RAYEN_IMPORT_STATE)).toEqual(
      expect.objectContaining({ isBusy: false, isSyncing: false, error: expect.any(String) })
    );
  });

  it('ignores a callback whose request no longer belongs to an active run', () => {
    const failRun = vi.fn().mockResolvedValue(undefined);
    const previewSnapshot = vi.fn();
    const setState = vi.fn();
    renderHook(() =>
      useRayenImportCapture({
        currentRecord: record,
        setState,
        setStaffingProposal: vi.fn(),
        setStaffingProposalError: vi.fn(),
        clearSyncTimeout: vi.fn(),
        syncRequestController: {
          start: vi.fn(),
          cancel: vi.fn(),
          getRunId: vi.fn().mockReturnValue(null),
        },
        syncTargetRef: { current: null },
        startRun: vi.fn(() => ({
          id: 'new-run',
          startedAt: '2026-08-02T10:00:00.000Z',
          by: 'Operador HHR',
        })),
        failRun,
        recordRunPerformance: vi.fn(),
        previewSnapshot,
      })
    );

    const [onSnapshot] = bridge.subscribeSnapshots.mock.calls[0] as unknown as [
      (snapshot: unknown, bundle: unknown, requestId: string) => void,
    ];
    const [onError] = bridge.subscribeErrors.mock.calls[0] as unknown as [
      (error: string, requestId: string) => void,
    ];
    act(() => {
      onSnapshot('late-snapshot', 'late-bundle', 'old-request');
      onError('late-error', 'old-request');
    });

    expect(previewSnapshot).not.toHaveBeenCalled();
    expect(failRun).not.toHaveBeenCalled();
    expect(setState).not.toHaveBeenCalled();
  });
});
