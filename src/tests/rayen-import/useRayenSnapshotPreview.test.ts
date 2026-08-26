import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/features/rayen-import/contracts/rayenDomainContracts';
import type { RayenImportState } from '@/features/rayen-import/hooks/rayenImportState';
import {
  RayenHistoricalCorrectionAfterCommitError,
  RayenStructuralPlanChangedError,
} from '@/features/rayen-import/hooks/confirmRayenImport';
import { useRayenSnapshotPreview } from '@/features/rayen-import/hooks/useRayenSnapshotPreview';

const mocks = vi.hoisted(() => ({
  applyConfirmedRayenImport: vi.fn(),
  prepareRayenStructuralPlan: vi.fn(),
}));

vi.mock('@/features/rayen-import/hooks/confirmRayenImport', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/rayen-import/hooks/confirmRayenImport')>()),
  applyConfirmedRayenImport: mocks.applyConfirmedRayenImport,
}));

vi.mock('@/features/rayen-import/hooks/prepareRayenStructuralPlan', () => ({
  prepareRayenStructuralPlan: mocks.prepareRayenStructuralPlan,
}));

vi.mock('@/features/rayen-import/hooks/useTreatingPhysicianCatalogSync', () => ({
  useTreatingPhysicianCatalogSync: () => (snapshot: unknown) => snapshot,
}));

vi.mock('@/features/rayen-import/hooks/rayenSnapshotPreviewPreparation', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/features/rayen-import/hooks/rayenSnapshotPreviewPreparation')
  >()),
  createRayenPlanningMetrics: () => ({
    reconciliationStartedAt: Date.now(),
    counters: { requests: 0, cacheHits: 0, timeouts: 0 },
    measureEvidence: async <T>(operation: () => Promise<T>) => operation(),
    getHistoricalEvidenceMs: () => 0,
  }),
  prepareRayenSnapshotEvidence: () => ({
    valid: true,
    isHistoricalDay: false,
    reportDate: '2026-08-25',
  }),
}));

const record = {
  date: '2026-08-25',
  beds: {},
  discharges: [],
  transfers: [],
  cma: [],
  activeExtraBeds: [],
  lastUpdated: '2026-08-25T09:00:00.000Z',
} as DailyRecord;

const noChangeDiff = {
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

const autoApplyDiff = {
  ...noChangeDiff,
  admissions: [{ bedId: 'R1' }],
  unchangedCount: 0,
  summary: { ...noChangeDiff.summary, admissions: 1, unchanged: 0 },
} as CensusImportDiff;

const committedResult = (
  diff: CensusImportDiff,
  {
    skipped = [],
    confirmedHandoff = { source: 'snapshot-commit' },
  }: { skipped?: unknown[]; confirmedHandoff?: Record<string, unknown> } = {}
) => ({
  appliedDiff: diff,
  skipped,
  historicalCorrectionsPending: false,
  confirmedHandoff,
});

const snapshot = {
  capturedAt: '2026-08-25T10:00:00.000Z',
  facilityId: 1342,
  encounters: [],
};

const initialState: RayenImportState = {
  diff: null,
  isPreviewOpen: false,
  isBusy: false,
  isSyncing: true,
  result: null,
  hasSkippedItems: false,
  error: null,
};

const renderPreview = (
  mode: 'auto' | 'preview',
  { monotonicNow = Date.now }: { monotonicNow?: () => number } = {}
) => {
  const setState = vi.fn();
  const dispatchExecution = vi.fn();
  const runClinicalStage = vi.fn().mockResolvedValue({ status: 'complete' });
  const failRun = vi.fn().mockResolvedValue(undefined);
  const recordRunPerformance = vi.fn();
  const preparedSyncContextRef = {
    current: {
      runId: 'run-1',
      record,
      selectedDate: record.date,
      target: {
        kind: 'current' as const,
        calendarDay: record.date,
        clinicalDay: record.date,
        lookbackDays: 0,
      },
      range: { dateStart: record.date, dateEnd: record.date },
      preparedAt: '2026-08-25T10:00:00.000Z',
    },
  };
  const executionRef = {
    current: {
      context: {
        runId: 'run-1',
        requestId: 'request-1',
        selectedDate: record.date,
      },
      pending: { runId: 'run-1', selectedDate: record.date },
      stage: { type: 'planning_structure' },
      outcome: { structuralConflicts: 0, skippedItems: 0 },
    },
  };
  const structuralReplanRef = { current: null };
  const structuralPersistenceExecutionKeysRef = { current: new Set<string>() };
  const run = {
    id: 'run-1',
    sourceDate: record.date,
    startedAt: '2026-08-25T10:00:00.000Z',
    by: 'Operador HHR',
    policy: { mode, clinicalBatchMode: 'enforced', revision: 1 },
  };
  const hook = renderHook(() =>
    useRayenSnapshotPreview({
      dailyRecord: {} as never,
      isAdmin: false,
      setState,
      dispatchExecution,
      executionRef: executionRef as never,
      selectedDateRef: { current: record.date },
      clearSyncTimeout: vi.fn(),
      applyDiff: vi.fn() as never,
      runClinicalStage,
      failRun,
      ensureRun: vi.fn().mockReturnValue(run),
      getRun: vi.fn().mockReturnValue(run),
      recordRunPerformance,
      preparedSyncContextRef: preparedSyncContextRef as never,
      structuralReplanRef,
      structuralPersistenceExecutionKeysRef,
      runSerializedPersistence: operation => operation(),
      loadAuthoritativeStructuralRecord: vi.fn(),
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
  };
};

const appliedState = (setState: ReturnType<typeof vi.fn>): RayenImportState =>
  setState.mock.calls.reduce(
    (state, [update]) => (typeof update === 'function' ? update(state) : update),
    initialState
  );

describe('useRayenSnapshotPreview structural persistence routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists and continues clinical work through the automatic route', async () => {
    mocks.prepareRayenStructuralPlan.mockResolvedValue({
      diff: autoApplyDiff,
      replanDiff: vi.fn(),
    });
    const result = committedResult(autoApplyDiff);
    mocks.applyConfirmedRayenImport.mockResolvedValue(result);
    const harness = renderPreview('auto');

    await act(async () => harness.result.current(snapshot, {} as never, 'run-1', 'request-1'));

    expect(mocks.applyConfirmedRayenImport).toHaveBeenCalledOnce();
    expect(harness.runClinicalStage).toHaveBeenCalledWith({ source: 'snapshot-commit' });
    expect(harness.dispatchExecution).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'transition', stage: { type: 'persisting_structure' } })
    );
    expect(appliedState(harness.setState)).toMatchObject({
      diff: autoApplyDiff,
      result,
      isPreviewOpen: false,
      isBusy: false,
      hasSkippedItems: false,
    });
    expect(harness.failRun).not.toHaveBeenCalled();
  });

  it('starts review timing only when a structural plan waits for a person', async () => {
    mocks.prepareRayenStructuralPlan.mockResolvedValue({
      diff: autoApplyDiff,
      replanDiff: vi.fn(),
    });
    const harness = renderPreview('preview', { monotonicNow: () => 4_200 });

    await act(async () => harness.result.current(snapshot, {} as never, 'run-1', 'request-1'));

    expect(harness.structuralReplanRef.current).toMatchObject({ reviewStartedAtMs: 4_200 });
    expect(harness.recordRunPerformance).not.toHaveBeenCalledWith(
      expect.objectContaining({
        stagesMs: expect.objectContaining({ reviewWait: expect.anything() }),
      }),
      expect.anything()
    );
    expect(mocks.applyConfirmedRayenImport).not.toHaveBeenCalled();
  });

  it('measures automatic structural persistence without inventing review wait', async () => {
    mocks.prepareRayenStructuralPlan.mockResolvedValue({
      diff: autoApplyDiff,
      replanDiff: vi.fn(),
    });
    mocks.applyConfirmedRayenImport.mockResolvedValue(committedResult(autoApplyDiff));
    const monotonicNow = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_240);
    const harness = renderPreview('auto', { monotonicNow });

    await act(async () => harness.result.current(snapshot, {} as never, 'run-1', 'request-1'));

    expect(harness.recordRunPerformance).toHaveBeenCalledWith(
      { stagesMs: { structuralPersistence: 240 } },
      'run-1'
    );
    expect(harness.recordRunPerformance).not.toHaveBeenCalledWith(
      expect.objectContaining({
        stagesMs: expect.objectContaining({ reviewWait: expect.anything() }),
      }),
      expect.anything()
    );
  });

  it('persists and continues clinical work through the no-change route', async () => {
    mocks.prepareRayenStructuralPlan.mockResolvedValue({
      diff: noChangeDiff,
      replanDiff: vi.fn(),
    });
    const result = committedResult(noChangeDiff);
    mocks.applyConfirmedRayenImport.mockResolvedValue(result);
    const harness = renderPreview('preview');

    await act(async () => harness.result.current(snapshot, {} as never, 'run-1', 'request-1'));

    expect(mocks.applyConfirmedRayenImport).toHaveBeenCalledOnce();
    expect(harness.runClinicalStage).toHaveBeenCalledWith({ source: 'snapshot-commit' });
    expect(harness.dispatchExecution).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'transition', stage: { type: 'persisting_structure' } })
    );
    expect(appliedState(harness.setState)).toMatchObject({
      diff: noChangeDiff,
      result,
      isPreviewOpen: false,
      isBusy: false,
      isSyncing: false,
      hasSkippedItems: false,
    });
    expect(harness.failRun).not.toHaveBeenCalled();
  });

  it('surfaces omissions from the automatic route without failing the run', async () => {
    mocks.prepareRayenStructuralPlan.mockResolvedValue({
      diff: autoApplyDiff,
      replanDiff: vi.fn(),
    });
    const result = committedResult(autoApplyDiff, {
      skipped: [{ kind: 'admission', bedId: 'R1' }],
    });
    mocks.applyConfirmedRayenImport.mockResolvedValue(result);
    const harness = renderPreview('auto');

    await act(async () => harness.result.current(snapshot, {} as never, 'run-1', 'request-1'));

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
    mocks.prepareRayenStructuralPlan.mockResolvedValue({
      diff: autoApplyDiff,
      replanDiff: vi.fn(),
    });
    const result = committedResult(autoApplyDiff, {
      confirmedHandoff: { source: 'committed-correction' },
    });
    const error = new RayenHistoricalCorrectionAfterCommitError(
      result as never,
      new Error('historical conflict')
    );
    mocks.applyConfirmedRayenImport.mockRejectedValue(error);
    const harness = renderPreview('auto');

    await act(async () => harness.result.current(snapshot, {} as never, 'run-1', 'request-1'));

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

  it('returns a changed no-change plan to review without marking the run failed', async () => {
    mocks.prepareRayenStructuralPlan.mockResolvedValue({
      diff: noChangeDiff,
      replanDiff: vi.fn(),
    });
    const replannedDiff = {
      ...noChangeDiff,
      conflicts: [{ bedId: 'R1' }],
      summary: { ...noChangeDiff.summary, conflicts: 1 },
    } as CensusImportDiff;
    const freshRecord = { ...record, lastUpdated: '2026-08-25T09:01:00.000Z' };
    const error = new RayenStructuralPlanChangedError(freshRecord, replannedDiff);
    mocks.applyConfirmedRayenImport.mockRejectedValue(error);
    const harness = renderPreview('preview');

    await act(async () => harness.result.current(snapshot, {} as never, 'run-1', 'request-1'));

    expect(harness.preparedSyncContextRef.current).toMatchObject({ record: freshRecord });
    expect(harness.dispatchExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transition',
        stage: { type: 'needs_review', scope: 'structure' },
      })
    );
    expect(appliedState(harness.setState)).toMatchObject({
      diff: replannedDiff,
      isPreviewOpen: true,
      result: null,
      error: error.message,
    });
    expect(harness.failRun).not.toHaveBeenCalled();
    expect(harness.runClinicalStage).not.toHaveBeenCalled();
  });

  it('continues a committed clinical handoff after its UI execution is superseded', async () => {
    mocks.prepareRayenStructuralPlan.mockResolvedValue({
      diff: autoApplyDiff,
      replanDiff: vi.fn(),
    });
    let resolvePersistence!: (value: unknown) => void;
    mocks.applyConfirmedRayenImport.mockReturnValue(
      new Promise(resolve => {
        resolvePersistence = resolve;
      })
    );
    const harness = renderPreview('auto');

    const persistence = harness.result.current(snapshot, {} as never, 'run-1', 'request-1');
    await vi.waitFor(() => expect(mocks.applyConfirmedRayenImport).toHaveBeenCalledOnce());
    harness.executionRef.current = {
      ...harness.executionRef.current,
      context: { ...harness.executionRef.current.context, requestId: 'request-2' },
      stage: { type: 'cancelled' },
    } as never;
    resolvePersistence(committedResult(autoApplyDiff));

    await act(async () => persistence);

    expect(harness.runClinicalStage).toHaveBeenCalledOnce();
    expect(harness.runClinicalStage).toHaveBeenCalledWith({ source: 'snapshot-commit' });
    expect(harness.recordRunPerformance).not.toHaveBeenCalledWith(
      expect.objectContaining({
        stagesMs: expect.objectContaining({ structuralPersistence: expect.anything() }),
      }),
      expect.anything()
    );
  });
});
