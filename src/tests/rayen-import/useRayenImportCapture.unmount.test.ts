import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExecutionHarness } from './support/executionHarness';
import { useRayenImportCapture } from '@/features/rayen-import/hooks/useRayenImportCapture';
import { setSessionGeneration } from '@/services/storage/sessionStorageTransition';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';

vi.mock('@/features/rayen-import/bridge/rayenImportBridge', () => ({
  subscribeToRayenSnapshots: () => () => undefined,
  subscribeToRayenImportErrors: () => () => undefined,
}));

const record = {
  date: '2026-08-02',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: 'revision-original',
} as DailyRecord;
const health = { connection: 'ready' as const, report: null, message: 'ok', canSync: true };

const setup = () => {
  let resolve!: (value: DailyRecord) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<DailyRecord>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const execution = createExecutionHarness();
  const start = vi.fn(() => 'request-1');
  const failRun = vi.fn().mockResolvedValue(undefined);
  const setState = vi.fn();
  const hook = renderHook(() =>
    useRayenImportCapture({
      ...execution,
      currentRecord: record,
      policy: { mode: 'preview', clinicalBatchMode: 'enforced', revision: 1 },
      policyStatus: 'ready',
      setState,
      setStaffingProposal: vi.fn(),
      setStaffingProposalError: vi.fn(),
      clearSyncTimeout: vi.fn(),
      syncRequestController: { start, cancel: vi.fn(), getRunId: () => 'run-1' },
      preparedSyncContextRef: { current: null },
      loadFreshRecord: () => pending,
      startRun: () => ({
        id: 'run-1',
        startedAt: '2026-08-02T10:00:00Z',
        by: 'Operador',
        sourceDate: record.date,
      }),
      failRun,
      recordRunPerformance: vi.fn(),
      previewSnapshot: vi.fn(),
    })
  );
  return { ...hook, resolve, reject, execution, start, failRun, setState };
};

afterEach(() => setSessionGeneration(null));

describe('capture preparation ownership', () => {
  it.each(['resolve', 'reject'] as const)(
    'does not continue after unmount (%s)',
    async completion => {
      const h = setup();
      let operation!: Promise<unknown>;
      act(() => {
        operation = h.result.current(health);
      });
      h.unmount();
      h.setState.mockClear();
      await act(async () => {
        if (completion === 'resolve') h.resolve(record);
        else h.reject(new Error('late read failure'));
        await operation;
      });
      expect(h.start).not.toHaveBeenCalled();
      expect(h.failRun).not.toHaveBeenCalled();
      expect(h.setState).not.toHaveBeenCalled();
    }
  );

  it.each(['resolve', 'reject'] as const)(
    'does not continue for a replaced session (%s)',
    async completion => {
      setSessionGeneration('session-original');
      const h = setup();
      let operation!: Promise<unknown>;
      act(() => {
        operation = h.result.current(health);
      });
      setSessionGeneration('session-replacement');
      h.setState.mockClear();
      await act(async () => {
        if (completion === 'resolve') h.resolve(record);
        else h.reject(new Error('late read failure'));
        await operation;
      });
      expect(h.start).not.toHaveBeenCalled();
      expect(h.failRun).not.toHaveBeenCalled();
      expect(h.setState).not.toHaveBeenCalled();
      expect(h.execution.executionRef.current.stage).toEqual({ type: 'cancelled' });
      if (completion === 'resolve') {
        await act(async () => {
          await h.result.current(health);
        });
        expect(h.start).toHaveBeenCalledOnce();
      }
    }
  );

  it('blocks a retained trigger after its owner unmounts', async () => {
    const h = setup();
    const trigger = h.result.current;
    h.unmount();
    h.resolve(record);
    await expect(trigger(health)).resolves.toBe('blocked');
    expect(h.setState).not.toHaveBeenCalled();
    expect(h.start).not.toHaveBeenCalled();
  });
  it('does not cancel a committed clinical execution when the view unmounts', async () => {
    const h = setup();
    await act(async () => {
      const operation = h.result.current(health);
      h.resolve(record);
      await operation;
    });
    for (const type of [
      'planning_structure',
      'persisting_structure',
      'verifying_structure',
      'syncing_clinical',
    ] as const) {
      h.execution.dispatchExecution({ type: 'transition', runId: 'run-1', stage: { type } });
    }
    h.unmount();
    expect(h.execution.executionRef.current.stage).toEqual({ type: 'syncing_clinical' });
    expect(h.failRun).not.toHaveBeenCalled();
  });
});
