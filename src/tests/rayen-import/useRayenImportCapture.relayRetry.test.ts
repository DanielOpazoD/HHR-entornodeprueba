import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PreparedRayenSyncContext } from '@/features/rayen-import/hooks/rayenSyncTemporalContext';
import {
  GESTION_CAMAS_CAPTURE_RETRY_DELAY_MS,
  useRayenImportCapture,
} from '@/features/rayen-import/hooks/useRayenImportCapture';
import { createActiveExecutionHarness } from './support/executionHarness';

const bridge = vi.hoisted(() => ({
  subscribeSnapshots: vi.fn(() => vi.fn()),
  subscribeErrors: vi.fn(() => vi.fn()),
}));

vi.mock('@/features/rayen-import/bridge/rayenSnapshotBridge', () => ({
  subscribeToRayenSnapshots: bridge.subscribeSnapshots,
  subscribeToRayenImportErrors: bridge.subscribeErrors,
}));

const record = {
  date: '2026-08-02',
  beds: {},
  lastUpdated: '2026-08-02T09:00:00.000Z',
} as DailyRecord;
const prepared = {
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
} as PreparedRayenSyncContext;

const setup = () => {
  let active = 'request-1';
  const start = vi.fn((_start: string, _end: string, _run: string, _onTimeout: () => void) => {
    active = 'request-2';
    return active;
  });
  const failRun = vi.fn().mockResolvedValue(undefined);
  const recordRunPerformance = vi.fn();
  const preparedSyncContextRef = { current: prepared as PreparedRayenSyncContext | null };
  const harness = createActiveExecutionHarness();
  const view = renderHook(() =>
    useRayenImportCapture({
      ...harness,
      currentRecord: record,
      policy: { mode: 'preview', clinicalBatchMode: 'enforced', revision: 1 },
      policyStatus: 'ready',
      setState: vi.fn(),
      setStaffingProposal: vi.fn(),
      setStaffingProposalError: vi.fn(),
      clearSyncTimeout: vi.fn(),
      syncRequestController: {
        start,
        cancel: vi.fn(),
        getRunId: vi.fn((requestId: string) => (requestId === active ? 'run-1' : null)),
      },
      preparedSyncContextRef,
      loadFreshRecord: vi.fn().mockResolvedValue(record),
      startRun: vi.fn(),
      failRun,
      recordRunPerformance,
      previewSnapshot: vi.fn(),
    } as never)
  );
  const [onError] = bridge.subscribeErrors.mock.calls[0] as unknown as [
    (error: string, requestId: string, timeoutStage?: string) => void,
  ];
  return {
    onError,
    start,
    failRun,
    recordRunPerformance,
    harness,
    preparedSyncContextRef,
    unmount: view.unmount,
  };
};

describe('capture when Ficha Médico does not answer in time', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['ficha_main_relay', 'ficha_tab_relay'])(
    'tries once more in silence after %s, keeping the same run',
    stage => {
      const { onError, start, failRun, recordRunPerformance, harness, preparedSyncContextRef } =
        setup();

      act(() => onError('Tiempo de espera', 'request-1', stage));

      expect(failRun).not.toHaveBeenCalled();
      expect(start).toHaveBeenCalledOnce();
      expect(start.mock.calls[0].slice(0, 3)).toEqual(['2026-08-02', '2026-08-02', 'run-1']);
      expect(harness.executionRef.current.context?.requestId).toBe('request-2');
      expect(harness.executionRef.current.stage).toEqual({ type: 'capturing' });
      expect(preparedSyncContextRef.current).toBe(prepared);
      expect(recordRunPerformance).toHaveBeenCalledWith({ counters: { retries: 1 } }, 'run-1');
    }
  );

  it('reports the failure when the second attempt does not answer either', () => {
    const { onError, start, failRun } = setup();

    act(() => onError('Tiempo de espera', 'request-1', 'ficha_main_relay'));
    act(() => onError('Tiempo de espera', 'request-2', 'ficha_main_relay'));

    expect(start).toHaveBeenCalledOnce();
    expect(failRun).toHaveBeenCalledWith(
      'snapshot_timeout',
      'run-1',
      undefined,
      'ficha_relay_timeout'
    );
  });

  it('retries a dropped connection once, without telling anyone', () => {
    const { onError, start, failRun } = setup();

    act(() => onError('Failed to fetch', 'request-1'));

    expect(start).toHaveBeenCalledOnce();
    expect(failRun).not.toHaveBeenCalled();
  });

  it('reports a connection that stays down after the second attempt', () => {
    const { onError, start, failRun } = setup();

    act(() => onError('Failed to fetch', 'request-1'));
    act(() => onError('Failed to fetch', 'request-2'));

    expect(start).toHaveBeenCalledOnce();
    expect(failRun).toHaveBeenCalledWith('snapshot_network_error', 'run-1', undefined, 'other');
  });

  it('does not retry a failure that needs a person, such as an expired session', () => {
    const { onError, start, failRun } = setup();

    act(() => onError('La sesión clínica venció. Inicia sesión.', 'request-1'));

    expect(start).not.toHaveBeenCalled();
    expect(failRun).toHaveBeenCalledWith('ficha_medico_unavailable', 'run-1', undefined, 'other');
  });
});

describe('capture when Gestión de Camas is not ready', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it.each([
    'La pestaña de Gestión de Camas no respondió a la comprobación.',
    'El relé de Gestión de Camas perdió conexión con la extensión.',
    'Gestión de Camas está abierta, pero su sesión todavía no está disponible.',
    'El servidor de reportes respondió HTTP 500.',
  ])('waits a few seconds and tries once more in silence: %s', message => {
    const { onError, start, failRun, recordRunPerformance, harness } = setup();

    act(() => onError(message, 'request-1'));

    expect(failRun).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(harness.executionRef.current.stage).toEqual({ type: 'capturing' });
    act(() => vi.advanceTimersByTime(GESTION_CAMAS_CAPTURE_RETRY_DELAY_MS));
    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0].slice(0, 3)).toEqual(['2026-08-02', '2026-08-02', 'run-1']);
    expect(harness.executionRef.current.context?.requestId).toBe('request-2');
    expect(recordRunPerformance).toHaveBeenCalledWith({ counters: { retries: 1 } }, 'run-1');
  });

  it('tells the person when Gestión de Camas fails again after the retry', () => {
    const { onError, start, failRun } = setup();

    act(() =>
      onError('La pestaña de Gestión de Camas no respondió a la comprobación.', 'request-1')
    );
    act(() => vi.advanceTimersByTime(GESTION_CAMAS_CAPTURE_RETRY_DELAY_MS));
    act(() =>
      onError('La pestaña de Gestión de Camas no respondió a la comprobación.', 'request-2')
    );

    expect(start).toHaveBeenCalledOnce();
    expect(failRun).toHaveBeenCalledWith(
      'gestion_camas_unavailable',
      'run-1',
      undefined,
      'gc_tab_unresponsive'
    );
  });

  it.each([
    ['La sesión de Gestión de Camas venció. Vuelve a conectarla.', 'gc_session_expired'],
    ['Abre Gestión de Camas e inicia sesión para sincronizar.', 'gc_session_missing'],
    [
      'Abre una pestaña nueva de Gestión de Camas: la pestaña actual está desactualizada.',
      'gc_tab_outdated',
    ],
    ['Gestión de Camas no está abierta.', 'gc_session_missing'],
  ])('does not retry what only a person can solve: %s', (message, check) => {
    const { onError, start, failRun } = setup();

    act(() => onError(message, 'request-1'));

    expect(start).not.toHaveBeenCalled();
    expect(failRun).toHaveBeenCalledWith('gestion_camas_unavailable', 'run-1', undefined, check);
  });

  it('does not start the retry after the run was cancelled during the wait', () => {
    const { onError, start, failRun, harness } = setup();

    act(() =>
      onError('La pestaña de Gestión de Camas no respondió a la comprobación.', 'request-1')
    );
    act(() => harness.dispatchExecution({ type: 'cancel', runId: 'run-1' }));
    act(() => vi.advanceTimersByTime(GESTION_CAMAS_CAPTURE_RETRY_DELAY_MS));

    expect(start).not.toHaveBeenCalled();
    expect(failRun).not.toHaveBeenCalled();
  });

  it('does not start the retry after leaving the page during the wait', () => {
    const { onError, start, unmount } = setup();

    act(() =>
      onError('La pestaña de Gestión de Camas no respondió a la comprobación.', 'request-1')
    );
    unmount();
    act(() => vi.advanceTimersByTime(GESTION_CAMAS_CAPTURE_RETRY_DELAY_MS));

    expect(start).not.toHaveBeenCalled();
  });
});
