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
  resolveSyncReportRequest: (candidate: DailyRecord) => ({
    target: {
      kind: 'current',
      calendarDay: candidate.date,
      clinicalDay: candidate.date,
      lookbackDays: 0,
    },
    range: { dateStart: candidate.date, dateEnd: candidate.date },
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
const policy = { mode: 'preview' as const, clinicalBatchMode: 'enforced' as const, revision: 3 };

describe('useRayenImportCapture lifecycle guards', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records one preflight failure without reading or writing the census', async () => {
    const loadFreshRecord = vi.fn().mockResolvedValue(record);
    const startRequest = vi.fn();
    const failRun = vi.fn().mockResolvedValue(undefined);
    const startRun = vi.fn(() => ({
      id: 'run-offline',
      startedAt: '2026-08-02T10:00:00.000Z',
      by: 'Operador HHR',
      sourceDate: '2026-08-02',
    }));
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
          getRunId: vi.fn().mockReturnValue(null),
        },
        preparedSyncContextRef: { current: null },
        loadFreshRecord,
        startRun,
        failRun,
        recordRunPerformance: vi.fn(),
        previewSnapshot: vi.fn(),
      })
    );

    await act(async () => {
      await result.current({
        connection: 'offline',
        report: null,
        message: 'La extensión Eloísa no respondió.',
        canSync: false,
      });
    });

    expect(startRun).toHaveBeenCalledOnce();
    expect(failRun).toHaveBeenCalledOnce();
    expect(failRun).toHaveBeenCalledWith('extension_unavailable', 'run-offline');
    expect(loadFreshRecord).not.toHaveBeenCalled();
    expect(startRequest).not.toHaveBeenCalled();
  });

  it('closes the request and terminalizes the active run when the extension reports an error', () => {
    const clearSyncTimeout = vi.fn();
    const failRun = vi.fn().mockResolvedValue(undefined);
    const setState = vi.fn();
    const preparedSyncContextRef: { current: PreparedRayenSyncContext | null } = {
      current: {
        runId: 'run-1',
        record,
        selectedDate: '2026-08-02',
        target: {
          kind: 'current',
          calendarDay: '2026-08-02',
          clinicalDay: '2026-08-02',
          lookbackDays: 0,
        },
        range: { dateStart: '2026-08-02', dateEnd: '2026-08-02' },
        preparedAt: '2026-08-02T10:00:00.000Z',
      },
    };
    renderHook(() =>
      useRayenImportCapture({
        currentRecord: record,
        policy,
        policyStatus: 'ready',
        setState,
        setStaffingProposal: vi.fn(),
        setStaffingProposalError: vi.fn(),
        clearSyncTimeout,
        syncRequestController: {
          start: vi.fn(),
          cancel: vi.fn(),
          getRunId: vi.fn().mockReturnValue('run-1'),
        },
        preparedSyncContextRef,
        loadFreshRecord: vi.fn().mockResolvedValue(record),
        startRun: vi.fn(),
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
    expect(preparedSyncContextRef.current).toBeNull();
    expect(failRun).toHaveBeenCalledWith('snapshot_error', 'run-1');
    const stateUpdater = setState.mock.calls[0]?.[0] as (
      state: typeof INITIAL_RAYEN_IMPORT_STATE
    ) => typeof INITIAL_RAYEN_IMPORT_STATE;
    expect(stateUpdater(INITIAL_RAYEN_IMPORT_STATE)).toEqual(
      expect.objectContaining({ isBusy: false, isSyncing: false, error: expect.any(String) })
    );
  });

  it('archiva la causa real del error de captura y muestra el remedio (pestaña de Ficha Médico inactiva)', () => {
    const failRun = vi.fn().mockResolvedValue(undefined);
    const setState = vi.fn();
    renderHook(() =>
      useRayenImportCapture({
        currentRecord: record,
        policy,
        policyStatus: 'ready',
        setState,
        setStaffingProposal: vi.fn(),
        setStaffingProposalError: vi.fn(),
        clearSyncTimeout: vi.fn(),
        syncRequestController: {
          start: vi.fn(),
          cancel: vi.fn(),
          getRunId: vi.fn().mockReturnValue('run-1'),
        },
        preparedSyncContextRef: { current: null },
        loadFreshRecord: vi.fn().mockResolvedValue(record),
        startRun: vi.fn(),
        failRun,
        recordRunPerformance: vi.fn(),
        previewSnapshot: vi.fn(),
      })
    );
    const [onError] = bridge.subscribeErrors.mock.calls[0] as unknown as [
      (error: string, requestId: string) => void,
    ];
    // Mensaje real de la extensión el 02-09: la salud decía «lista» y la
    // lectura fallaba en 1 s; antes se archivaba como snapshot_error genérico.
    act(() =>
      onError(
        'No se pudo leer Rayen. Recarga la pestaña de Ficha Médico (Cmd+R) para activar la extensión y reintenta. Detalle: Failed to fetch',
        'request-1'
      )
    );
    expect(failRun).toHaveBeenCalledWith('ficha_medico_stale', 'run-1');
    const stateUpdater = setState.mock.calls[0]?.[0] as (
      state: typeof INITIAL_RAYEN_IMPORT_STATE
    ) => typeof INITIAL_RAYEN_IMPORT_STATE;
    expect(stateUpdater(INITIAL_RAYEN_IMPORT_STATE).error).toContain('Recárgala (Cmd+R)');
  });

  it('ignores a callback whose request no longer belongs to an active run', () => {
    const failRun = vi.fn().mockResolvedValue(undefined);
    const previewSnapshot = vi.fn();
    const setState = vi.fn();
    renderHook(() =>
      useRayenImportCapture({
        currentRecord: record,
        policy,
        policyStatus: 'ready',
        setState,
        setStaffingProposal: vi.fn(),
        setStaffingProposalError: vi.fn(),
        clearSyncTimeout: vi.fn(),
        syncRequestController: {
          start: vi.fn(),
          cancel: vi.fn(),
          getRunId: vi.fn().mockReturnValue(null),
        },
        preparedSyncContextRef: { current: null },
        loadFreshRecord: vi.fn().mockResolvedValue(record),
        startRun: vi.fn(),
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

  it('does not start a run when the global policy is not server-confirmed', async () => {
    const setState = vi.fn();
    const startRun = vi.fn();
    const startRequest = vi.fn();
    const executionRef: { current: RayenSyncExecutionState } = {
      current: rayenSyncExecutionReducer(
        rayenSyncExecutionReducer(INITIAL_RAYEN_SYNC_EXECUTION_STATE, {
          type: 'prepare',
          runId: 'old-run',
          selectedDate: '2026-08-02',
        }),
        { type: 'transition', runId: 'old-run', stage: { type: 'complete' } }
      ),
    };
    const dispatchExecution = vi.fn((action: RayenSyncExecutionAction) => {
      executionRef.current = rayenSyncExecutionReducer(executionRef.current, action);
    });
    const { result } = renderHook(() =>
      useRayenImportCapture({
        currentRecord: record,
        policy,
        policyStatus: 'fallback',
        dispatchExecution,
        executionRef,
        setState,
        setStaffingProposal: vi.fn(),
        setStaffingProposalError: vi.fn(),
        clearSyncTimeout: vi.fn(),
        syncRequestController: {
          start: startRequest,
          cancel: vi.fn(),
          getRunId: vi.fn().mockReturnValue(null),
        },
        preparedSyncContextRef: { current: null },
        loadFreshRecord: vi.fn().mockResolvedValue(record),
        startRun,
        failRun: vi.fn(),
        recordRunPerformance: vi.fn(),
        previewSnapshot: vi.fn(),
      })
    );
    await act(async () => {
      await result.current({ connection: 'ready', report: null, message: 'ok', canSync: true });
    });
    expect(startRun).not.toHaveBeenCalled();
    expect(startRequest).not.toHaveBeenCalled();
    expect(executionRef.current).toBe(INITIAL_RAYEN_SYNC_EXECUTION_STATE);
    const stateUpdater = setState.mock.calls[0]?.[0] as (
      state: typeof INITIAL_RAYEN_IMPORT_STATE
    ) => typeof INITIAL_RAYEN_IMPORT_STATE;
    expect(stateUpdater(INITIAL_RAYEN_IMPORT_STATE)).toEqual(
      expect.objectContaining({
        isSyncing: false,
        error: expect.stringContaining('política global'),
      })
    );
  });

  it('waits for the record that matches the route-selected date', async () => {
    const setState = vi.fn();
    const startRun = vi.fn();
    const startRequest = vi.fn();
    const { result } = renderHook(() =>
      useRayenImportCapture({
        currentRecord: record,
        selectedDate: '2026-08-03',
        policy,
        policyStatus: 'ready',
        setState,
        setStaffingProposal: vi.fn(),
        setStaffingProposalError: vi.fn(),
        clearSyncTimeout: vi.fn(),
        syncRequestController: {
          start: startRequest,
          cancel: vi.fn(),
          getRunId: vi.fn().mockReturnValue(null),
        },
        preparedSyncContextRef: { current: null },
        loadFreshRecord: vi.fn().mockResolvedValue(record),
        startRun,
        failRun: vi.fn(),
        recordRunPerformance: vi.fn(),
        previewSnapshot: vi.fn(),
      })
    );
    await act(async () => {
      await result.current({ connection: 'ready', report: null, message: 'ok', canSync: true });
    });
    expect(startRun).not.toHaveBeenCalled();
    expect(startRequest).not.toHaveBeenCalled();
    const stateUpdater = setState.mock.calls.at(-1)?.[0] as (
      state: typeof INITIAL_RAYEN_IMPORT_STATE
    ) => typeof INITIAL_RAYEN_IMPORT_STATE;
    expect(stateUpdater(INITIAL_RAYEN_IMPORT_STATE)).toEqual(
      expect.objectContaining({
        isSyncing: false,
        error: expect.stringContaining('todavía está cargando'),
      })
    );
  });
});
