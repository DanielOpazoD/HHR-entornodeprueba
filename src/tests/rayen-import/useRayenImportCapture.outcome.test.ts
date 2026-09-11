import { act, renderHook } from '@testing-library/react';
import { createExecutionHarness } from './support/executionHarness';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRayenImportCapture } from '@/features/rayen-import/hooks/useRayenImportCapture';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { PreparedRayenSyncContext } from '@/features/rayen-import/hooks/rayenSyncTemporalContext';
import type { RayenExtensionHealthState } from '@/features/rayen-import/hooks/useRayenExtensionHealth';

/**
 * Resultado de una captura. El arranque del día desde Eloísa sólo puede dar su solicitud por
 * atendida cuando la captura dejó evidencia; si la compuerta la bloqueó sin registrar nada, el
 * llamador debe conservar el intento. Este contrato es lo que impide que un día recién creado
 * quede sin una sola sincronización por una carrera de carga.
 */

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
  resolveSyncReportRequest: () => ({
    target: {
      kind: 'current',
      calendarDay: '2026-09-10',
      clinicalDay: '2026-09-10',
      lookbackDays: 0,
    },
    range: { dateStart: '2026-09-10', dateEnd: '2026-09-11' },
  }),
}));

const record = {
  date: '2026-09-10',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  lastUpdated: '2026-09-10T12:00:00.000Z',
  activeExtraBeds: [],
} as DailyRecord;
const policy = { mode: 'auto' as const, clinicalBatchMode: 'enforced' as const, revision: 7 };

const readyHealth: RayenExtensionHealthState = {
  connection: 'ready',
  report: null,
  message: 'ok',
  canSync: true,
};
const downHealth: RayenExtensionHealthState = {
  connection: 'offline',
  report: null,
  message: 'Extensión no detectada.',
  canSync: false,
};

const renderCapture = (overrides: Partial<Parameters<typeof useRayenImportCapture>[0]> = {}) => {
  const preparedSyncContextRef: { current: PreparedRayenSyncContext | null } = { current: null };
  const deps = {
    ...createExecutionHarness(),
    currentRecord: record,
    policy,
    policyStatus: 'ready' as const,
    setState: vi.fn(),
    setStaffingProposal: vi.fn(),
    setStaffingProposalError: vi.fn(),
    clearSyncTimeout: vi.fn(),
    syncRequestController: { start: vi.fn(), cancel: vi.fn(), getRunId: vi.fn() },
    preparedSyncContextRef,
    loadFreshRecord: vi.fn().mockResolvedValue(record),
    startRun: vi.fn(() => ({
      id: 'run-outcome',
      startedAt: '2026-09-10T12:33:35.000Z',
      by: 'Operador HHR',
      sourceDate: '2026-09-10',
    })),
    failRun: vi.fn().mockResolvedValue(undefined),
    recordRunPerformance: vi.fn(),
    previewSnapshot: vi.fn(),
    ...overrides,
  };
  const hook = renderHook(() => useRayenImportCapture(deps));
  return { ...hook, deps };
};

describe('useRayenImportCapture · resultado del intento', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports `started` when a run was created and the extension request went out', async () => {
    const { result, deps } = renderCapture();

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current(readyHealth);
    });

    expect(outcome).toBe('started');
    expect(deps.startRun).toHaveBeenCalledTimes(1);
    expect(deps.syncRequestController.start).toHaveBeenCalledTimes(1);
  });

  it('reports `started` even when the extension is down, because the failure is recorded', async () => {
    const { result, deps } = renderCapture();

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current(downHealth);
    });

    expect(outcome).toBe('started');
    expect(deps.failRun).toHaveBeenCalledWith(expect.any(String), 'run-outcome');
  });

  it('reports `blocked` while the global policy is still loading', async () => {
    const { result, deps } = renderCapture({ policyStatus: 'loading' });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current(readyHealth);
    });

    expect(outcome).toBe('blocked');
    expect(deps.startRun).not.toHaveBeenCalled();
  });

  it('reports `blocked` when the selected census has not loaded yet', async () => {
    const { result, deps } = renderCapture({ currentRecord: null, selectedDate: '2026-09-10' });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current(readyHealth);
    });

    expect(outcome).toBe('blocked');
    expect(deps.startRun).not.toHaveBeenCalled();
    expect(deps.setState).toHaveBeenCalled();
  });

  it('reports `blocked` when the loaded census belongs to another date', async () => {
    const { result, deps } = renderCapture({ selectedDate: '2026-09-11' });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current(readyHealth);
    });

    expect(outcome).toBe('blocked');
    expect(deps.startRun).not.toHaveBeenCalled();
  });
});
