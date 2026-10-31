import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { PreparedRayenSyncContext } from '@/features/rayen-import/hooks/rayenSyncTemporalContext';
import { useRayenImportCapture } from '@/features/rayen-import/hooks/useRayenImportCapture';
import { createActiveExecutionHarness } from './support/executionHarness';

const bridge = vi.hoisted(() => ({
  subscribeSnapshots: vi.fn(() => vi.fn()),
  subscribeErrors: vi.fn(() => vi.fn()),
}));

vi.mock('@/features/rayen-import/bridge/rayenImportBridge', () => ({
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
  renderHook(() =>
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
  return { onError, start, failRun, recordRunPerformance, harness, preparedSyncContextRef };
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
    expect(failRun).toHaveBeenCalledWith('snapshot_timeout', 'run-1');
  });

  it('does not retry any other failure', () => {
    const { onError, start, failRun } = setup();

    act(() => onError('Failed to fetch', 'request-1'));

    expect(start).not.toHaveBeenCalled();
    expect(failRun).toHaveBeenCalledOnce();
  });
});
