import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { RayenImportState } from '@/features/rayen-import/hooks/rayenImportState';
import {
  RayenHistoricalCorrectionAfterCommitError,
  RayenStructuralPlanChangedError,
} from '@/features/rayen-import/hooks/confirmRayenImport';
import { useRayenSnapshotPreview } from '@/features/rayen-import/hooks/useRayenSnapshotPreview';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';

// Native Storage from a fresh window, so the session owner, generation and cleanup mark behave
// as shipped during a real logout.
const storageFrame = document.createElement('iframe');
document.body.append(storageFrame);
const local = storageFrame.contentWindow!.localStorage;
Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
Object.defineProperty(globalThis, 'sessionStorage', {
  value: storageFrame.contentWindow!.sessionStorage,
  configurable: true,
});

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

const admissionDiff = {
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
  result: null,
  hasSkippedItems: false,
  error: null,
};

const renderPreview = ({
  monotonicNow = Date.now,
  reviewRequirement,
  loadInvalidEpisodeIds = vi.fn().mockResolvedValue(new Set<string>()),
  runSerializedPersistence = operation => operation(),
}: {
  monotonicNow?: () => number;
  reviewRequirement?: 'day_bootstrap';
  loadInvalidEpisodeIds?: () => Promise<ReadonlySet<string>>;
  runSerializedPersistence?: <T>(operation: () => Promise<T>) => Promise<T>;
} = {}) => {
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
    policy: { mode: 'preview', clinicalBatchMode: 'enforced', revision: 1 },
    reviewRequirement,
  };
  const hook = renderHook(() =>
    useRayenSnapshotPreview({
      dailyRecord: { getAuthoritativeForDate: async () => null } as never,
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
      runSerializedPersistence,
      loadAuthoritativeStructuralRecord: vi.fn(),
      loadInvalidEpisodeIds,
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

// Control Date only; preserve native timers and asynchronous I/O.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-30T12:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

describe('useRayenSnapshotPreview structural persistence routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires human review even for a conflict-free admission', async () => {
    mocks.prepareRayenStructuralPlan.mockResolvedValue({
      diff: admissionDiff,
      replanDiff: vi.fn(),
    });
    const harness = renderPreview();

    await act(async () => harness.result.current(snapshot, {} as never, 'run-1', 'request-1'));

    expect(mocks.applyConfirmedRayenImport).not.toHaveBeenCalled();
    expect(harness.runClinicalStage).not.toHaveBeenCalled();
    expect(appliedState(harness.setState)).toMatchObject({
      diff: admissionDiff,
      result: null,
      isPreviewOpen: true,
      error: null,
    });
    expect(harness.failRun).not.toHaveBeenCalled();
  });

  it('plans against the patients marked as not valid, read from the server', async () => {
    mocks.prepareRayenStructuralPlan.mockResolvedValue({
      diff: admissionDiff,
      replanDiff: vi.fn(),
    });
    const marked = new Set(['900001']);
    const harness = renderPreview({ loadInvalidEpisodeIds: vi.fn().mockResolvedValue(marked) });

    await act(async () => harness.result.current(snapshot, {} as never, 'run-1', 'request-1'));

    expect(mocks.prepareRayenStructuralPlan).toHaveBeenCalledWith(
      expect.objectContaining({ invalidEpisodeIds: marked })
    );
  });

  it('stops the run instead of planning when the list of patients not valid cannot be read', async () => {
    const harness = renderPreview({
      loadInvalidEpisodeIds: vi.fn().mockRejectedValue(new Error('unavailable')),
    });

    await act(async () => harness.result.current(snapshot, {} as never, 'run-1', 'request-1'));

    expect(mocks.prepareRayenStructuralPlan).not.toHaveBeenCalled();
    expect(harness.failRun).toHaveBeenCalledWith('apply_failed', 'run-1');
    expect(appliedState(harness.setState)).toMatchObject({
      error:
        'La lista de pacientes no válidos todavía no se leyó. Revisa la conexión y vuelve a intentar.',
    });
  });

  it('keeps a day created from Eloisa under human review', async () => {
    mocks.prepareRayenStructuralPlan.mockResolvedValue({
      diff: admissionDiff,
      replanDiff: vi.fn(),
    });
    const harness = renderPreview({ reviewRequirement: 'day_bootstrap' });

    await act(async () => harness.result.current(snapshot, {} as never, 'run-1', 'request-1'));

    expect(mocks.applyConfirmedRayenImport).not.toHaveBeenCalled();
    expect(harness.dispatchExecution).not.toHaveBeenCalledWith(
      expect.objectContaining({ stage: { type: 'persisting_structure' } })
    );
    expect(appliedState(harness.setState)).toMatchObject({
      diff: admissionDiff,
      isPreviewOpen: true,
      result: null,
      error: null,
    });
    expect(harness.failRun).not.toHaveBeenCalled();
  });

  it('starts review timing only when a structural plan waits for a person', async () => {
    mocks.prepareRayenStructuralPlan.mockResolvedValue({
      diff: admissionDiff,
      replanDiff: vi.fn(),
    });
    const harness = renderPreview({ monotonicNow: () => 4_200 });

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

  it('measures no-change structural persistence without inventing review wait', async () => {
    mocks.prepareRayenStructuralPlan.mockResolvedValue({
      diff: noChangeDiff,
      replanDiff: vi.fn(),
    });
    mocks.applyConfirmedRayenImport.mockResolvedValue(committedResult(noChangeDiff));
    const monotonicNow = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_240);
    const harness = renderPreview({ monotonicNow });

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
    const harness = renderPreview();

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
      hasSkippedItems: false,
    });
    expect(harness.failRun).not.toHaveBeenCalled();
  });

  it('keeps conflict-only review visible when clinical completion settles the execution', async () => {
    const diff = {
      ...noChangeDiff,
      conflicts: [{ bedId: 'R1', reason: 'Historical location requires review.' }],
      summary: { ...noChangeDiff.summary, conflicts: 1 },
    };
    mocks.prepareRayenStructuralPlan.mockResolvedValue({ diff, replanDiff: vi.fn() });
    mocks.applyConfirmedRayenImport.mockResolvedValue(committedResult(diff));
    const harness = renderPreview();
    harness.runClinicalStage.mockImplementation(async () => {
      harness.executionRef.current.stage = { type: 'complete' };
      return { status: 'complete' };
    });

    await act(async () => harness.result.current(snapshot, {} as never, 'run-1', 'request-1'));

    expect(appliedState(harness.setState)).toMatchObject({ diff, isPreviewOpen: true });
    expect(harness.runClinicalStage).toHaveBeenCalledOnce();
  });

  it('surfaces omissions from the no-change route without failing the run', async () => {
    mocks.prepareRayenStructuralPlan.mockResolvedValue({
      diff: noChangeDiff,
      replanDiff: vi.fn(),
    });
    const result = committedResult(noChangeDiff, {
      skipped: [{ kind: 'admission', bedId: 'R1' }],
    });
    mocks.applyConfirmedRayenImport.mockResolvedValue(result);
    const harness = renderPreview();

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
      diff: noChangeDiff,
      replanDiff: vi.fn(),
    });
    const result = committedResult(noChangeDiff, {
      confirmedHandoff: { source: 'committed-correction' },
    });
    const error = new RayenHistoricalCorrectionAfterCommitError(
      result as never,
      new Error('historical conflict')
    );
    mocks.applyConfirmedRayenImport.mockRejectedValue(error);
    const harness = renderPreview();

    await act(async () => harness.result.current(snapshot, {} as never, 'run-1', 'request-1'));

    expect(harness.runClinicalStage).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'committed-correction',
        historicalCorrectionsRequireFreshCapture: true,
      })
    );
    expect(appliedState(harness.setState)).toMatchObject({
      result,
      isPreviewOpen: false,
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
    const harness = renderPreview();

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
      diff: noChangeDiff,
      replanDiff: vi.fn(),
    });
    let resolvePersistence!: (value: unknown) => void;
    mocks.applyConfirmedRayenImport.mockReturnValue(
      new Promise(resolve => {
        resolvePersistence = resolve;
      })
    );
    const harness = renderPreview();

    const persistence = harness.result.current(snapshot, {} as never, 'run-1', 'request-1');
    await vi.waitFor(() => expect(mocks.applyConfirmedRayenImport).toHaveBeenCalledOnce());
    harness.executionRef.current = {
      ...harness.executionRef.current,
      context: { ...harness.executionRef.current.context, requestId: 'request-2' },
      stage: { type: 'cancelled' },
    } as never;
    resolvePersistence(committedResult(noChangeDiff));

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

  describe('a run of A whose session ends (real logout, then B signs in)', () => {
    beforeEach(async () => {
      local.clear();
      await reconcileAuthorizedSessionOwner('user:synthetic-A');
    });
    const switchToB = async () => {
      await clearSessionScopedClientState('manual');
      await reconcileAuthorizedSessionOwner('user:synthetic-B');
    };

    const persistAcrossSessionChange = async (
      settle: (harness: ReturnType<typeof renderPreview>) => void
    ) => {
      mocks.prepareRayenStructuralPlan.mockResolvedValue({
        diff: noChangeDiff,
        replanDiff: vi.fn(),
      });
      let release!: () => void;
      const harness = renderPreview();
      mocks.applyConfirmedRayenImport.mockReturnValue(
        new Promise<void>(resolve => {
          release = resolve;
        }).then(() => settle(harness))
      );
      const persistence = harness.result.current(snapshot, {} as never, 'run-1', 'request-1');
      await vi.waitFor(() => expect(mocks.applyConfirmedRayenImport).toHaveBeenCalledOnce());
      const statesBefore = harness.setState.mock.calls.length;
      await switchToB();
      release();
      await act(async () => persistence);
      return { harness, statesAfter: harness.setState.mock.calls.length - statesBefore };
    };

    it('a commit answered afterwards starts no clinical work and shows nothing', async () => {
      const { harness, statesAfter } = await persistAcrossSessionChange(() =>
        committedResult(noChangeDiff)
      );

      expect(harness.runClinicalStage).not.toHaveBeenCalled();
      expect(statesAfter).toBe(0);
    });

    it('a failure answered afterwards records and shows nothing', async () => {
      const { harness, statesAfter } = await persistAcrossSessionChange(() => {
        throw new Error('La sesión cambió antes de enviar la escritura.');
      });

      expect(harness.failRun).not.toHaveBeenCalled();
      expect(statesAfter).toBe(0);
    });

    it('a commit answered while the logout cleanup runs starts no clinical work', async () => {
      mocks.prepareRayenStructuralPlan.mockResolvedValue({
        diff: noChangeDiff,
        replanDiff: vi.fn(),
      });
      let release!: () => void;
      let saving!: () => void;
      const reached = new Promise<void>(resolve => (saving = resolve));
      mocks.applyConfirmedRayenImport.mockImplementationOnce(() => {
        saving();
        return new Promise(resolve => (release = () => resolve(committedResult(noChangeDiff))));
      });
      const harness = renderPreview();
      const work = harness.result.current(snapshot, {} as never, 'run-1', 'request-1');
      await reached;
      let finish!: () => void;
      let arrived!: () => void;
      const cleaning = new Promise<void>(resolve => (arrived = resolve));
      // Owner and generation still match here; only the cleanup mark says the session is ending.
      const closing = clearSessionScopedClientState('manual', () => {
        arrived();
        return new Promise<void>(resolve => (finish = resolve));
      });
      await cleaning;
      try {
        harness.setState.mockClear();
        release();
        await act(async () => work);

        // Before the fix: { clinical: 1, ui: 1 }.
        expect(harness.runClinicalStage).not.toHaveBeenCalled();
        expect(harness.setState).not.toHaveBeenCalled();
      } finally {
        finish();
        await closing;
      }
    });

    it('a checkpoint whose turn comes after the session ended is never saved', async () => {
      mocks.prepareRayenStructuralPlan.mockResolvedValue({
        diff: noChangeDiff,
        replanDiff: vi.fn(),
      });
      mocks.applyConfirmedRayenImport.mockResolvedValue(committedResult(noChangeDiff));
      let releaseTurn!: () => void;
      const turn = new Promise<void>(resolve => (releaseTurn = resolve));
      let queued!: () => void;
      const reachedQueue = new Promise<void>(resolve => (queued = resolve));
      const harness = renderPreview({
        runSerializedPersistence: operation => {
          queued();
          return turn.then(operation);
        },
      });
      const work = harness.result.current(snapshot, {} as never, 'run-1', 'request-1');
      await reachedQueue;
      await switchToB();
      releaseTurn();
      await act(async () => work);

      expect(mocks.applyConfirmedRayenImport).not.toHaveBeenCalled();
      expect(harness.runClinicalStage).not.toHaveBeenCalled();
    });

    it('a plan delivered afterwards is neither shown nor put up for review', async () => {
      let release!: () => void;
      const waiting = new Promise<void>(resolve => (release = resolve));
      mocks.prepareRayenStructuralPlan.mockImplementationOnce(async () => {
        await waiting;
        return { diff: admissionDiff, replanDiff: vi.fn() };
      });
      const harness = renderPreview();
      const work = harness.result.current(snapshot, {} as never, 'run-1', 'request-1');
      await vi.waitFor(() => expect(mocks.prepareRayenStructuralPlan).toHaveBeenCalled());
      await switchToB();
      harness.setState.mockClear();
      harness.dispatchExecution.mockClear();
      release();
      await act(async () => work);

      // Before the fix: the proposal opened with one admission and the run went to awaiting_review.
      expect(harness.setState).not.toHaveBeenCalled();
      expect(harness.dispatchExecution).not.toHaveBeenCalled();
      expect(harness.structuralReplanRef.current).toBeNull();
    });

    it.each([
      ['its view unmounted', false],
      ['its session ended after unmounting', true],
    ])('a read answered after %s asks the extension nothing about A', async (_label, logout) => {
      const actual = await vi.importActual<
        typeof import('@/features/rayen-import/hooks/prepareRayenStructuralPlan')
      >('@/features/rayen-import/hooks/prepareRayenStructuralPlan');
      mocks.prepareRayenStructuralPlan.mockImplementationOnce(actual.prepareRayenStructuralPlan);
      let release!: () => void;
      const wait = new Promise<void>(resolve => (release = resolve));
      const loadInvalidEpisodeIds = vi.fn(async () => {
        await wait;
        return new Set<string>();
      });
      const harness = renderPreview({ loadInvalidEpisodeIds });
      const egresoRow = {
        run: '11.111.111-1',
        patientName: 'PACIENTE SINTETICO A',
        fechaEgreso: '25-08-2026 12:00',
        correctedDay: '2026-08-25',
        correctedTime: '12:00',
        bedLabel: 'R1',
        destino: 'Domicilio',
      };
      const work = harness.result.current(
        snapshot,
        { egresoRows: [egresoRow] } as never,
        'run-1',
        'request-1'
      );
      await vi.waitFor(() => expect(loadInvalidEpisodeIds).toHaveBeenCalledOnce());
      harness.unmount();
      if (logout) await switchToB();
      const post = vi.spyOn(window, 'postMessage');
      // A query that does go out is answered at once, so the case fails on the assertion below
      // instead of waiting for the extension.
      post.mockImplementation(message => {
        if (message?.type !== 'HHR_RAYEN_EGRESO_LOOKUP_REQUEST') return;
        queueMicrotask(() =>
          window.dispatchEvent(
            new MessageEvent('message', {
              source: window,
              origin: window.location.origin,
              data: { type: 'HHR_RAYEN_EGRESO_LOOKUP_RESULT', reqId: message.reqId, results: [] },
            })
          )
        );
      });
      try {
        release();
        await work;

        // Before the fix: HHR_RAYEN_EGRESO_LOOKUP_REQUEST for A's RUN during B's session.
        expect(post.mock.calls.map(([message]) => message?.type)).not.toContain(
          'HHR_RAYEN_EGRESO_LOOKUP_REQUEST'
        );
        expect(harness.setState).not.toHaveBeenCalled();
      } finally {
        post.mockRestore();
      }
    });
  });
});
