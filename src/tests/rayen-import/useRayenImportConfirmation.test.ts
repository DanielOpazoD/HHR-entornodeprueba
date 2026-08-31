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
import type {
  ClinicalFillRequest,
  ClinicalStageResult,
} from '@/features/rayen-import/contracts/clinicalStageResult';
import type { RayenSyncPerformanceDelta } from '@/types/domain/rayenSync';

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
  reviewStartedAtMs,
  monotonicNow = Date.now,
  recordRunPerformance = vi.fn(),
  structuralPersistenceExecutionKeys = new Set<string>(),
}: {
  executionRef?: ReturnType<typeof createExecutionRef>;
  runClinicalStage?: (source: ClinicalFillRequest) => Promise<ClinicalStageResult>;
  reviewStartedAtMs?: number;
  monotonicNow?: () => number;
  recordRunPerformance?: (delta: RayenSyncPerformanceDelta, runId?: string) => void;
  structuralPersistenceExecutionKeys?: Set<string>;
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
      ...(reviewStartedAtMs == null ? {} : { reviewStartedAtMs }),
      replan: vi.fn(),
    },
  };
  const structuralPersistenceExecutionKeysRef = {
    current: structuralPersistenceExecutionKeys,
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
      structuralPersistenceExecutionKeysRef,
      selectedDateRef: { current: record.date },
      dailyRecord: {} as never,
      isAdmin: false,
      ensureRun: vi.fn().mockReturnValue({ id: 'run-1' }),
      failRun,
      recordRunPerformance,
      applyDiff: vi.fn() as never,
      runClinicalStage,
      loadAuthoritativeStructuralRecord: vi.fn(),
      runSerializedPersistence: operation => operation(),
      monotonicNow,
    })
  );
  return {
    ...hook,
    dispatchExecution,
    executionRef,
    failRun,
    preparedSyncContextRef,
    recordRunPerformance,
    runClinicalStage,
    setState,
    structuralReplanRef,
    structuralPersistenceExecutionKeysRef,
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
    let completePersistence!: () => void;
    mocks.applyConfirmedRayenImport.mockImplementation(
      () =>
        new Promise(resolve => {
          completePersistence = () => resolve(result);
        })
    );
    const harness = renderConfirmation();
    let confirmation!: Promise<void>;
    act(() => {
      confirmation = harness.result.current();
    });
    expect(appliedState(harness.setState)).toMatchObject({
      isPreviewOpen: false,
      isBusy: true,
      isSyncing: true,
    });
    await act(async () => {
      completePersistence();
      await confirmation;
    });
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
  it('separates human review wait from structural persistence time', async () => {
    mocks.applyConfirmedRayenImport.mockResolvedValue(committedResult());
    const monotonicNow = vi
      .fn()
      .mockReturnValueOnce(1_600)
      .mockReturnValueOnce(1_700)
      .mockReturnValueOnce(1_825);
    const harness = renderConfirmation({ reviewStartedAtMs: 1_000, monotonicNow });

    await act(async () => harness.result.current());

    expect(harness.recordRunPerformance).toHaveBeenCalledWith(
      { stagesMs: { reviewWait: 600 } },
      'run-1'
    );
    expect(harness.recordRunPerformance).toHaveBeenCalledWith(
      { stagesMs: { structuralPersistence: 125 } },
      'run-1'
    );
    expect(harness.structuralReplanRef.current).toBeNull();
  });

  it('continues the confirmed import if aggregate telemetry reporting fails', async () => {
    mocks.applyConfirmedRayenImport.mockResolvedValue(committedResult());
    const recordRunPerformance = vi.fn(() => {
      throw new Error('telemetry failed');
    });
    const harness = renderConfirmation({
      reviewStartedAtMs: 1_000,
      monotonicNow: vi
        .fn()
        .mockReturnValueOnce(1_500)
        .mockReturnValueOnce(1_600)
        .mockReturnValueOnce(1_700),
      recordRunPerformance,
    });

    await act(async () => harness.result.current());

    expect(mocks.applyConfirmedRayenImport).toHaveBeenCalledOnce();
    expect(harness.runClinicalStage).toHaveBeenCalledOnce();
    expect(harness.failRun).not.toHaveBeenCalled();
  });

  it('starts a fresh review interval after structural replanning', async () => {
    const freshRecord = { ...record, lastUpdated: '2026-07-28T10:01:00.000Z' };
    const error = new RayenStructuralPlanChangedError(freshRecord, diff);
    mocks.applyConfirmedRayenImport.mockRejectedValue(error);
    const monotonicNow = vi
      .fn()
      .mockReturnValueOnce(1_500)
      .mockReturnValueOnce(1_600)
      .mockReturnValueOnce(1_700)
      .mockReturnValueOnce(1_800);
    const harness = renderConfirmation({ reviewStartedAtMs: 1_000, monotonicNow });

    await act(async () => harness.result.current());

    expect(harness.recordRunPerformance).toHaveBeenCalledWith(
      { stagesMs: { reviewWait: 500 } },
      'run-1'
    );
    expect(harness.recordRunPerformance).toHaveBeenCalledWith(
      { stagesMs: { structuralPersistence: 100 } },
      'run-1'
    );
    expect(harness.structuralReplanRef.current).toMatchObject({ reviewStartedAtMs: 1_800 });
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
      // El commit ya ocurrió: el usuario sigue en el censo y la corrección
      // pendiente se comunica por el aviso de revisión, no reabriendo el modal.
      isPreviewOpen: false,
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

  it('releases shared ownership so the same reviewed execution can retry after replanning', async () => {
    const freshRecord = { ...record, lastUpdated: '2026-07-28T10:01:00.000Z' };
    const error = new RayenStructuralPlanChangedError(freshRecord, diff);
    const result = committedResult({ confirmedHandoff: { source: 'retried-confirmation' } });
    mocks.applyConfirmedRayenImport.mockRejectedValueOnce(error).mockResolvedValueOnce(result);
    const harness = renderConfirmation();

    await act(async () => harness.result.current());
    await act(async () => harness.result.current());

    expect(mocks.applyConfirmedRayenImport).toHaveBeenCalledTimes(2);
    expect(mocks.applyConfirmedRayenImport.mock.calls[1]?.[0]).toMatchObject({
      base: freshRecord,
    });
    expect(harness.runClinicalStage).toHaveBeenCalledOnce();
    expect(harness.runClinicalStage).toHaveBeenCalledWith({ source: 'retried-confirmation' });
    expect(harness.failRun).not.toHaveBeenCalled();
  });

  it('ignores a duplicate confirmation while the shared lifecycle owns the execution', async () => {
    let resolvePersistence!: (value: unknown) => void;
    mocks.applyConfirmedRayenImport.mockReturnValue(
      new Promise(resolve => {
        resolvePersistence = resolve;
      })
    );
    const harness = renderConfirmation();

    const firstConfirmation = harness.result.current();
    const duplicateConfirmation = harness.result.current();

    expect(mocks.applyConfirmedRayenImport).toHaveBeenCalledOnce();
    resolvePersistence(committedResult());
    await act(async () => Promise.all([firstConfirmation, duplicateConfirmation]));

    expect(mocks.applyConfirmedRayenImport).toHaveBeenCalledOnce();
    expect(harness.runClinicalStage).toHaveBeenCalledOnce();
    expect(harness.failRun).not.toHaveBeenCalled();
  });

  it('does not start confirmation when another structural route owns the execution', async () => {
    const executionKey = `run-1:request-1:${record.date}`;
    const structuralPersistenceExecutionKeys = new Set([executionKey]);
    const harness = renderConfirmation({ structuralPersistenceExecutionKeys });

    await act(async () => harness.result.current());

    expect(mocks.applyConfirmedRayenImport).not.toHaveBeenCalled();
    expect(harness.transitionExecution).not.toHaveBeenCalled();
    expect(harness.setState).not.toHaveBeenCalled();
    expect(structuralPersistenceExecutionKeys).toEqual(new Set([executionKey]));
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
    expect(harness.recordRunPerformance).not.toHaveBeenCalledWith(
      expect.objectContaining({
        stagesMs: expect.objectContaining({ structuralPersistence: expect.anything() }),
      }),
      expect.anything()
    );
  });
});
