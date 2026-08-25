import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import {
  RayenHistoricalCorrectionAfterCommitError,
  RayenStructuralPlanChangedError,
} from '@/features/rayen-import/hooks/confirmRayenImport';
import { useRayenImportConfirmation } from '@/features/rayen-import/hooks/useRayenImportConfirmation';
import type { RayenImportState } from '@/features/rayen-import/hooks/rayenImportState';

const mocks = vi.hoisted(() => ({
  applyConfirmedRayenImport: vi.fn(),
}));

vi.mock('@/features/rayen-import/hooks/confirmRayenImport', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/rayen-import/hooks/confirmRayenImport')>()),
  applyConfirmedRayenImport: mocks.applyConfirmedRayenImport,
}));

const diff = {
  admissions: [],
  updates: [],
  moves: [],
  discharges: [],
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 1,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: 0,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 1,
  },
} as CensusImportDiff;

const record = {
  date: '2026-07-28',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: '2026-07-28T10:00:00.000Z',
} as DailyRecord;

const initialState: RayenImportState = {
  diff,
  isPreviewOpen: true,
  isBusy: false,
  isSyncing: false,
  result: null,
  hasSkippedItems: false,
  error: null,
};

const committedResult = ({
  skipped = [],
  appliedDiff = diff,
  confirmedHandoff = {},
}: {
  skipped?: unknown[];
  appliedDiff?: CensusImportDiff;
  confirmedHandoff?: Record<string, unknown>;
} = {}) =>
  ({
    appliedDiff,
    skipped,
    historicalCorrectionsPending: false,
    confirmedHandoff,
  }) as never;

const createExecutionRef = () => ({
  current: {
    context: {
      runId: 'run-1',
      requestId: 'request-1',
      selectedDate: record.date,
    },
    pending: { runId: 'run-1', selectedDate: record.date },
    stage: { type: 'awaiting_review' },
    outcome: { structuralConflicts: 0, skippedItems: 0 },
  },
});

const renderConfirmation = ({
  executionRef = createExecutionRef(),
  runClinicalStage = vi.fn().mockResolvedValue({ status: 'complete' }),
} = {}) => {
  const setState = vi.fn();
  const dispatchExecution = vi.fn();
  const transitionExecution = vi.fn();
  const failRun = vi.fn();
  const preparedSyncContextRef = { current: { record, runId: 'run-1' } };
  const structuralReplanRef = {
    current: {
      runId: 'run-1',
      requestId: 'request-1',
      selectedDate: record.date,
      clinicalDay: record.date,
      replan: vi.fn(),
    },
  };
  const hook = renderHook(() =>
    useRayenImportConfirmation({
      currentRecord: record,
      currentRecordRef: { current: record },
      state: initialState,
      setState,
      executionRef: executionRef as never,
      dispatchExecution,
      transitionExecution,
      preparedSyncContextRef: preparedSyncContextRef as never,
      structuralReplanRef,
      selectedDateRef: { current: record.date },
      dailyRecord: {} as never,
      isAdmin: false,
      ensureRun: vi.fn().mockReturnValue({ id: 'run-1' }),
      failRun,
      recordRunPerformance: vi.fn(),
      applyDiff: vi.fn() as never,
      runClinicalStage,
      loadAuthoritativeStructuralRecord: vi.fn(),
      runSerializedPersistence: operation => operation(),
    })
  );
  return {
    ...hook,
    dispatchExecution,
    executionRef,
    failRun,
    preparedSyncContextRef,
    runClinicalStage,
    setState,
    transitionExecution,
  };
};

const appliedState = (setState: ReturnType<typeof vi.fn>): RayenImportState =>
  setState.mock.calls.reduce(
    (state, [update]) => (typeof update === 'function' ? update(state) : update),
    initialState
  );

describe('useRayenImportConfirmation execution ownership', () => {
  beforeEach(() => {
    mocks.applyConfirmedRayenImport.mockReset();
  });

  it('continues clinical work from an applied structural outcome', async () => {
    const result = committedResult({ confirmedHandoff: { source: 'confirmed' } });
    mocks.applyConfirmedRayenImport.mockResolvedValue(result);
    const harness = renderConfirmation();

    await act(async () => harness.result.current());

    expect(harness.dispatchExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'record_outcome',
        structuralConflicts: 0,
        skippedItems: 0,
      })
    );
    expect(harness.runClinicalStage).toHaveBeenCalledWith({ source: 'confirmed' });
    expect(appliedState(harness.setState)).toMatchObject({
      result,
      isPreviewOpen: false,
      hasSkippedItems: false,
      error: null,
    });
  });

  it('surfaces an applied outcome with omissions without failing the run', async () => {
    const result = committedResult({ skipped: [{ kind: 'admission', bedId: 'R1' }] });
    mocks.applyConfirmedRayenImport.mockResolvedValue(result);
    const harness = renderConfirmation();

    await act(async () => harness.result.current());

    expect(harness.dispatchExecution).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'record_outcome', skippedItems: 1 })
    );
    expect(appliedState(harness.setState)).toMatchObject({
      result,
      hasSkippedItems: true,
      error: null,
    });
    expect(harness.failRun).not.toHaveBeenCalled();
  });

  it('continues clinical work and requests a fresh capture after a committed correction fails', async () => {
    const result = committedResult({ confirmedHandoff: { source: 'committed-correction' } });
    const error = new RayenHistoricalCorrectionAfterCommitError(result, new Error('conflict'));
    mocks.applyConfirmedRayenImport.mockRejectedValue(error);
    const harness = renderConfirmation();

    await act(async () => harness.result.current());

    expect(harness.runClinicalStage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'committed-correction',
        historicalCorrectionsRequireFreshCapture: true,
      })
    );
    expect(appliedState(harness.setState)).toMatchObject({
      result,
      isPreviewOpen: true,
      hasSkippedItems: true,
      error: error.message,
    });
    expect(harness.failRun).not.toHaveBeenCalled();
  });

  it('fails an uncommitted structural persistence error without starting clinical work', async () => {
    const error = new Error('write failed');
    mocks.applyConfirmedRayenImport.mockRejectedValue(error);
    const harness = renderConfirmation();

    await act(async () => harness.result.current());

    expect(harness.transitionExecution).toHaveBeenCalledWith({ type: 'failed' }, 'run-1');
    expect(harness.failRun).toHaveBeenCalledWith('apply_failed', 'run-1');
    expect(harness.runClinicalStage).not.toHaveBeenCalled();
    expect(appliedState(harness.setState)).toMatchObject({
      isPreviewOpen: true,
      isBusy: false,
      isSyncing: false,
      error: 'write failed',
    });
  });

  it('returns a changed structural plan to review without marking the run failed', async () => {
    const replannedDiff = {
      ...diff,
      conflicts: [{ bedId: 'R1' }],
      summary: { ...diff.summary, conflicts: 1 },
    } as CensusImportDiff;
    const freshRecord = { ...record, lastUpdated: '2026-07-28T10:01:00.000Z' };
    const error = new RayenStructuralPlanChangedError(freshRecord, replannedDiff);
    mocks.applyConfirmedRayenImport.mockRejectedValue(error);
    const harness = renderConfirmation();

    await act(async () => harness.result.current());

    expect(harness.transitionExecution).toHaveBeenCalledWith(
      { type: 'needs_review', scope: 'structure' },
      'run-1'
    );
    expect(harness.preparedSyncContextRef.current).toMatchObject({ record: freshRecord });
    expect(appliedState(harness.setState)).toMatchObject({
      diff: replannedDiff,
      isPreviewOpen: true,
      result: null,
      error: error.message,
    });
    expect(harness.failRun).not.toHaveBeenCalled();
    expect(harness.runClinicalStage).not.toHaveBeenCalled();
  });

  it('handles a clinical failure after a normal commit through the existing failure path', async () => {
    mocks.applyConfirmedRayenImport.mockResolvedValue(committedResult());
    const clinicalError = new Error('clinical failed');
    const harness = renderConfirmation({
      runClinicalStage: vi.fn().mockRejectedValue(clinicalError),
    });

    await act(async () => harness.result.current());

    expect(harness.failRun).toHaveBeenCalledWith('apply_failed', 'run-1');
    expect(appliedState(harness.setState)).toMatchObject({ error: clinicalError.message });
  });

  it('preserves propagation of a clinical failure after a committed correction', async () => {
    const result = committedResult();
    const correctionError = new RayenHistoricalCorrectionAfterCommitError(
      result,
      new Error('conflict')
    );
    const clinicalError = new Error('clinical failed after correction');
    mocks.applyConfirmedRayenImport.mockRejectedValue(correctionError);
    const harness = renderConfirmation({
      runClinicalStage: vi.fn().mockRejectedValue(clinicalError),
    });

    await expect(harness.result.current()).rejects.toBe(clinicalError);

    expect(harness.failRun).not.toHaveBeenCalled();
  });

  it('enqueues a committed handoff after its reviewed UI execution is cancelled', async () => {
    let resolvePersistence!: (value: unknown) => void;
    let resolveClinicalStage!: (value: { status: 'complete' }) => void;
    mocks.applyConfirmedRayenImport.mockReturnValue(
      new Promise(resolve => {
        resolvePersistence = resolve;
      })
    );
    const executionRef = createExecutionRef();
    const runClinicalStage = vi.fn(
      () =>
        new Promise<{ status: 'complete' }>(resolve => {
          resolveClinicalStage = resolve;
        })
    );
    const harness = renderConfirmation({ executionRef, runClinicalStage });

    const confirmation = harness.result.current();
    executionRef.current = {
      ...executionRef.current,
      context: { ...executionRef.current.context, requestId: 'request-2' },
      stage: { type: 'cancelled' },
    };
    resolvePersistence(committedResult());

    await vi.waitFor(() => expect(runClinicalStage).toHaveBeenCalledOnce());
    let confirmationSettled = false;
    void confirmation.then(() => {
      confirmationSettled = true;
    });
    await Promise.resolve();
    expect(confirmationSettled).toBe(false);

    resolveClinicalStage({ status: 'complete' });
    await act(async () => confirmation);

    expect(runClinicalStage).toHaveBeenCalledOnce();
    expect(runClinicalStage).toHaveBeenCalledWith({});
  });
});
