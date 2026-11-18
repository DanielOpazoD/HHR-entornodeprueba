import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDailyRecordQuery, useSaveDailyRecordMutation } from '@/hooks/useDailyRecordQuery';
import { getDailyRecordQueryKey } from '@/hooks/controllers/dailyRecordQueryController';
import {
  getDailyRecordLastRemoteConfirmedAt,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { clearPendingDailyRecordPatchesForTests } from '@/hooks/controllers/dailyRecordPendingPatchController';
import { RepositoryProvider, createRepositoryContainer } from '@/services/RepositoryContext';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/storage/sessionScopedStorageService';
import {
  SESSION_GENERATION_KEY,
  setSessionGeneration,
} from '@/services/storage/sessionStorageTransition';
import { SESSION_OWNER_KEY } from '@/services/storage/sessionOwnerKey';
import { captureAuthoringSession } from '@/services/storage/authoringSession';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import {
  buildPatient,
  buildRecord,
} from '@/tests/services/repositories/dailyRecordRepositoryWriteServiceFixtures';
import { useRayenCensusDiffApplication } from '@/features/rayen-import/hooks/useRayenCensusDiffApplication';
import { finalizeRayenHistoricalDischarges } from '@/features/rayen-import/hooks/finalizeRayenHistoricalDischarges';
import { useRayenSyncAudit } from '@/features/rayen-import/hooks/useRayenSyncAudit';
import { createRayenSyncPersistenceQueue } from '@/features/rayen-import/hooks/rayenSyncPersistenceQueue';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { buildDischarge } from '@/features/rayen-import/domain/applyCensusImportDiff';
import type { CensusImportDiff } from '@/features/rayen-import/contracts/censusImportDiff';
import type { DailyRecordWriteLease } from '@/services/repositories/dailyRecordWriteCoordinator';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

/**
 * W14-RAY1 — a Rayen import whose server answer arrives after its session ended must not write
 * the departing person's census into the next session's cache. Logout clears the query cache
 * (useAuthState.ts); the next person's census reader must then read the day itself. The Rayen
 * hooks, the full-day save and the census reader are the shipped ones; only the repository's
 * answers are scripted and held until the session has changed.
 */
const date = '2026-09-27';
const historicalDate = '2026-09-26';
const NOTE = 'handoffNovedadesNightShift' as const;
const A_NOTE = 'CENSO SINTETICO A';
const NEXT = 'CENSO SINTETICO B';
const run = {
  id: 'synthetic-rayen-run-a',
  sourceDate: date,
  startedAt: '2026-09-28T03:00:00.000Z',
  by: 'Operador sintético A',
};
// What useRayenSyncAudit.startRun captures while A is signed in.
const A_SESSION = { ownerKey: 'user:synthetic-A', generation: 'synthetic-generation-A' };
const sentAsA = expect.objectContaining({ authoringSession: A_SESSION });

const emptyDiff = (discharges: CensusImportDiff['discharges'] = []): CensusImportDiff => ({
  admissions: [],
  updates: [],
  moves: [],
  discharges,
  pendingAdministrativeDischarges: [],
  conflicts: [],
  unchangedCount: 0,
  summary: {
    admissions: 0,
    updates: 0,
    moves: 0,
    discharges: discharges.length,
    pendingAdministrativeDischarges: 0,
    conflicts: 0,
    unchanged: 0,
  },
});
const stamp = (record: DailyRecord) => ({
  record: {
    ...record,
    rayenSync: { at: run.startedAt, by: run.by, runId: run.id, status: 'applied' },
    rayenSyncHistory: [{ ...run, completedAt: run.startedAt, status: 'applied' }],
  } as DailyRecord,
});
const recordOf = (day: string, note: string, extra: Partial<DailyRecord> = {}): DailyRecord => ({
  ...buildRecord(day),
  [NOTE]: note,
  ...extra,
});
const readOf = (record: DailyRecord | null) => ({
  date: record?.date ?? date,
  record,
  source: 'indexeddb' as const,
  serverConfirmed: false,
  compatibilityTier: 'none' as const,
  compatibilityIntensity: 'none' as const,
  migrationRulesApplied: [],
  consistencyState: 'local_only' as const,
  sourceOfTruth: 'local' as const,
  retryability: 'not_applicable' as const,
  recoveryAction: 'none' as const,
  conflictSummary: null,
  observabilityTags: ['daily_record', 'read'],
  repairApplied: false,
});
const confirmedWrite = (record: DailyRecord) => ({
  date: record.date,
  outcome: 'clean' as const,
  savedLocally: true,
  updatedRemotely: true,
  savedRemotely: true,
  queuedForRetry: false,
  autoMerged: false,
  confirmedRecord: record,
});

/** A promise the test resolves once the session has changed. */
const held = <T,>() => {
  let release!: (value: T) => void;
  const promise = new Promise<T>(resolve => {
    release = resolve;
  });
  return { promise, release };
};

// Native Storage from a fresh window, so the session owner and generation behave as shipped.
const storageFrame = document.createElement('iframe');
document.body.append(storageFrame);
const local = storageFrame.contentWindow!.localStorage;
const session = storageFrame.contentWindow!.sessionStorage;
afterAll(() => storageFrame.remove());

let client: QueryClient;
let repository: ReturnType<typeof buildMockDailyRecordRepository>;
let wrapper: (props: { children: ReactNode }) => ReactNode;

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
  Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
  local.clear();
  session.clear();
  onlineManager.setOnline(true);
  resetDailyRecordFreshnessGateForTests();
  clearPendingDailyRecordPatchesForTests();
  setSessionGeneration('synthetic-generation-A');
  local.setItem(SESSION_OWNER_KEY, 'user:synthetic-A');
  local.setItem(SESSION_GENERATION_KEY, 'synthetic-generation-A');
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 5 * 60 * 1000 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  repository = buildMockDailyRecordRepository();
  vi.mocked(repository.getForDateWithMeta).mockImplementation(async day =>
    readOf(recordOf(day, NEXT))
  );
  const container = createRepositoryContainer({ dailyRecord: repository });
  wrapper = ({ children }) => (
    <QueryClientProvider client={client}>
      <RepositoryProvider value={container}>{children}</RepositoryProvider>
    </QueryClientProvider>
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  clearPendingDailyRecordPatchesForTests();
  vi.restoreAllMocks();
});

/** Logout as the app runs it (cache cleared during the session cleanup), then B signs in. */
const switchToNextSession = async () => {
  await clearSessionScopedClientState('manual', async () => client.clear());
  await reconcileAuthorizedSessionOwner('user:synthetic-B');
};

/** The next person's census opens the day with the shipped reader. */
const openCensus = async (day = date) => {
  const readsBefore = vi.mocked(repository.getForDateWithMeta).mock.calls.length;
  const reader = renderHook(() => useDailyRecordQuery(day, false, 'local_only'), { wrapper });
  await waitFor(() => expect(reader.result.current.isFetching).toBe(false));
  return {
    rendered: reader.result.current.data?.[NOTE],
    reads: vi.mocked(repository.getForDateWithMeta).mock.calls.length - readsBefore,
  };
};
const B_READS_THE_DAY = { rendered: NEXT, reads: 1 };

type DiffApplicationInput = Parameters<typeof useRayenCensusDiffApplication>[0];
const renderDiffApplication = (overrides: Partial<DiffApplicationInput>) =>
  renderHook(
    () =>
      useRayenCensusDiffApplication({
        ensureRun: () => ({ ...run, authoringSession: A_SESSION }) as never,
        applyRunToRecord: stamp,
        saveDailyRecord: vi.fn() as never,
        checkpointRepository: { updatePartialDetailed: vi.fn() as never },
        queryClient: client,
        loadAuthoritativeRecord: async () => recordOf(date, A_NOTE),
        loadLocalRecord: async () =>
          ({
            record: null,
            writeState: 'none',
            hasPendingWrites: false,
            hasPendingWritesForDate: false,
          }) as never,
        recordRunPerformance: vi.fn(),
        ...overrides,
      }),
    { wrapper }
  ).result;

describe('selected-day checkpoint (useRayenCensusDiffApplication)', () => {
  it('a checkpoint confirmed after the session changed does not fill the next census', async () => {
    const answer = held<ReturnType<typeof confirmedWrite>>();
    const checkpoint = vi.fn(() => answer.promise);
    const apply = renderDiffApplication({
      checkpointRepository: { updatePartialDetailed: checkpoint as never },
    });
    let settled!: Promise<unknown>;
    act(() => {
      settled = apply.current(recordOf(date, A_NOTE), emptyDiff()).catch(error => error);
    });
    await waitFor(() => expect(checkpoint).toHaveBeenCalledTimes(1));

    await switchToNextSession();
    await act(async () => {
      answer.release(confirmedWrite(stamp(recordOf(date, A_NOTE)).record));
      await settled;
    });

    expect(checkpoint).toHaveBeenCalledWith(date, expect.anything(), sentAsA);
    expect(await openCensus()).toEqual(B_READS_THE_DAY);
    expect(getDailyRecordLastRemoteConfirmedAt(date)).toBeUndefined();
  });

  it('a stamp reread answered after the session changed does not fill the next census', async () => {
    const reread = held<DailyRecord>();
    let reads = 0;
    const apply = renderDiffApplication({
      // The checkpoint commits but answers without the run stamp: the hook reads once more.
      checkpointRepository: {
        updatePartialDetailed: vi.fn(async () => confirmedWrite(recordOf(date, A_NOTE))) as never,
      },
      loadAuthoritativeRecord: () => {
        reads += 1;
        return reads === 1 ? Promise.resolve(recordOf(date, A_NOTE)) : reread.promise;
      },
    });
    let settled!: Promise<unknown>;
    act(() => {
      settled = apply.current(recordOf(date, A_NOTE), emptyDiff()).catch(error => error);
    });
    await waitFor(() => expect(reads).toBe(2));

    await switchToNextSession();
    await act(async () => {
      reread.release(stamp(recordOf(date, A_NOTE, { lastUpdated: run.startedAt })).record);
      await settled;
    });

    expect(await openCensus()).toEqual(B_READS_THE_DAY);
    expect(getDailyRecordLastRemoteConfirmedAt(date)).toBeUndefined();
  });

  it('a session that ends while the census reads are cancelled is not filled either', async () => {
    const cancelled = held<void>();
    const cancelQueries = vi
      .spyOn(client, 'cancelQueries')
      .mockImplementationOnce(() => cancelled.promise);
    const apply = renderDiffApplication({
      checkpointRepository: {
        updatePartialDetailed: vi.fn(async () =>
          confirmedWrite(stamp(recordOf(date, A_NOTE)).record)
        ) as never,
      },
    });
    let settled!: Promise<unknown>;
    act(() => {
      settled = apply.current(recordOf(date, A_NOTE), emptyDiff()).catch(error => error);
    });
    await waitFor(() => expect(cancelQueries).toHaveBeenCalled());

    await switchToNextSession();
    await act(async () => {
      cancelled.release();
      await settled;
    });

    // The run stops: the hook's caller receives the stop, never a confirmed result.
    expect(await settled).toBeInstanceOf(Error);
    expect(await openCensus()).toEqual(B_READS_THE_DAY);
  });

  it('a step that begins after the session ended still sends as A and shows nothing', async () => {
    const checkpoint = vi.fn(async () => confirmedWrite(stamp(recordOf(date, A_NOTE)).record));
    const apply = renderDiffApplication({
      checkpointRepository: { updatePartialDetailed: checkpoint as never },
    });
    await switchToNextSession();

    let settled: unknown;
    await act(async () => {
      settled = await apply.current(recordOf(date, A_NOTE), emptyDiff()).catch(error => error);
    });

    // The repository refuses A's session; the scripted one answers, and the run still stops.
    expect(checkpoint).toHaveBeenCalledWith(date, expect.anything(), sentAsA);
    expect(settled).toBeInstanceOf(Error);
    expect(await openCensus()).toEqual(B_READS_THE_DAY);
  });

  it('the same session still shows its confirmed checkpoint', async () => {
    const confirmed = stamp(recordOf(date, A_NOTE)).record;
    const apply = renderDiffApplication({
      checkpointRepository: {
        updatePartialDetailed: vi.fn(async () => confirmedWrite(confirmed)) as never,
      },
    });
    await act(async () => {
      await apply.current(recordOf(date, A_NOTE), emptyDiff());
    });

    const shown = client.getQueryData<{ record: DailyRecord }>(getDailyRecordQueryKey(date));
    expect(shown?.record[NOTE]).toBe(A_NOTE);
    expect(getDailyRecordLastRemoteConfirmedAt(date)).toBeDefined();
  });
});

describe('selected-day full save (useRayenCensusDiffApplication + useSaveDailyRecordMutation)', () => {
  /** useRayenImport's saveRayenCensus, composed over the shipped save mutation. */
  const renderWithShippedSave = (loadLocalRecord: DiffApplicationInput['loadLocalRecord']) => {
    const save = renderHook(() => useSaveDailyRecordMutation(), { wrapper }).result;
    return renderDiffApplication({
      loadLocalRecord,
      saveDailyRecord: (
        record: DailyRecord,
        expectedLastUpdated: string,
        writeLease: DailyRecordWriteLease,
        baseRecord: DailyRecord,
        authoringSession = captureAuthoringSession()
      ) =>
        save.current.mutateAsync({
          authoringSession,
          record,
          baseRecord,
          expectedLastUpdated,
          requireConfirmedRecord: true,
          rayenStructuralWriteGuard: true,
          dailyRecordWriteLease: writeLease,
        }) as never,
    });
  };
  const pendingLocal = {
    record: null,
    writeState: 'active',
    hasPendingWrites: true,
    hasPendingWritesForDate: true,
  };

  it('a save answered after the session changed does not fill the next census', async () => {
    const answer = held<ReturnType<typeof confirmedWrite>>();
    vi.mocked(repository.saveDetailed).mockImplementation(() => answer.promise as never);
    const apply = renderWithShippedSave(async () => pendingLocal as never);
    let settled!: Promise<unknown>;
    act(() => {
      settled = apply.current(recordOf(date, A_NOTE), emptyDiff()).catch(error => error);
    });
    await waitFor(() => expect(repository.saveDetailed).toHaveBeenCalledTimes(1));

    await switchToNextSession();
    await act(async () => {
      answer.release(confirmedWrite(stamp(recordOf(date, A_NOTE)).record));
      await settled;
    });

    expect(await openCensus()).toEqual(B_READS_THE_DAY);
  });

  it('a save that begins after the session changed is sent as A, never as B', async () => {
    const localRead = held<never>();
    const loadLocalRecord = vi.fn(() => localRead.promise);
    vi.mocked(repository.saveDetailed).mockImplementation(
      async (record: DailyRecord) => confirmedWrite(record) as never
    );
    const apply = renderWithShippedSave(loadLocalRecord);
    let settled!: Promise<unknown>;
    act(() => {
      settled = apply.current(recordOf(date, A_NOTE), emptyDiff()).catch(error => error);
    });
    await waitFor(() => expect(loadLocalRecord).toHaveBeenCalledTimes(1));

    await switchToNextSession();
    await act(async () => {
      localRead.release(pendingLocal as never);
      await settled;
    });

    // The repository refuses a write whose session ended (dailyRecordPort.authoringBoundary).
    // Before the fix the save captured B's session here and B's census showed A's run.
    expect(repository.saveDetailed).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      sentAsA
    );
    expect(await openCensus()).toEqual(B_READS_THE_DAY);
  });
});

describe('historical discharge finalization (finalizeRayenHistoricalDischarges)', () => {
  const departed: PatientData = {
    ...buildPatient('R3', 'Paciente histórico sintético'),
    clinicalEpisodeId: 'episode-departed',
  };
  const entry = {
    bedId: 'R3',
    rut: departed.rut,
    patientName: departed.patientName,
    encounterId: departed.clinicalEpisodeId,
    kind: 'alta' as const,
    status: 'Vivo' as const,
    reason: 'administrative-discharge' as const,
    correctedDay: historicalDate,
    correctedTime: '15:00',
  };
  const selected = () =>
    stamp(recordOf(date, A_NOTE, { beds: { R3: departed }, lastUpdated: run.startedAt })).record;
  const history = () => {
    const record = recordOf(historicalDate, A_NOTE, { beds: { R3: departed } });
    record.discharges = [
      buildDischarge(departed, entry, record, {
        idFactory: () => 'historical-movement',
        now: new Date(run.startedAt),
        syncRunId: run.id,
      }),
    ];
    return record;
  };
  const cleared = (record: DailyRecord): DailyRecord => ({
    ...record,
    beds: { R3: { ...departed, patientName: '', rut: '', clinicalEpisodeId: '' } },
    lastUpdated: '2026-09-28T03:02:00.000Z',
  });
  const applied = () => {
    const record = selected();
    return {
      record,
      skipped: [],
      deferredHistoricalDischarges: [entry],
      confirmedHandoff: {
        runId: run.id,
        record,
        acceptedRevision: record.lastUpdated,
        safeClinicalEpisodeIds: [],
      },
      structuralStage: { status: 'confirmed' },
    } as never;
  };

  it.each([
    ['the selected day', date, false],
    ['the historical day', historicalDate, true],
  ] as const)(
    'a clearing of %s confirmed after the session changed does not fill the next census',
    async (_label, heldDay, clearHistoricalOccupants) => {
      const answer = held<ReturnType<typeof confirmedWrite>>();
      const finalRepository = {
        getAuthoritativeForDate: vi.fn(async (day: string) =>
          day === date ? selected() : history()
        ),
        updatePartialDetailed: vi.fn(async (day: string) => {
          const base = day === date ? selected() : history();
          return day === heldDay ? answer.promise : confirmedWrite(cleared(base));
        }),
      };
      let settled!: Promise<unknown>;
      act(() => {
        settled = finalizeRayenHistoricalDischarges(
          applied(),
          finalRepository as never,
          client,
          clearHistoricalOccupants,
          A_SESSION
        ).catch(error => error);
      });
      await waitFor(() =>
        expect(finalRepository.updatePartialDetailed).toHaveBeenCalledWith(
          heldDay,
          expect.anything(),
          expect.anything()
        )
      );

      await switchToNextSession();
      await act(async () => {
        answer.release(confirmedWrite(cleared(heldDay === date ? selected() : history())));
        await settled;
      });

      // The run stops at the held answer: nothing after it is written, as A or as B.
      expect(finalRepository.updatePartialDetailed).toHaveBeenCalledTimes(1);
      expect(finalRepository.updatePartialDetailed).toHaveBeenCalledWith(
        heldDay,
        expect.anything(),
        sentAsA
      );
      expect(await openCensus(heldDay)).toEqual(B_READS_THE_DAY);
      expect(getDailyRecordLastRemoteConfirmedAt(heldDay)).toBeUndefined();
    }
  );

  it('a session that ends while the census reads are cancelled is not filled either', async () => {
    const cancelled = held<void>();
    const cancelQueries = vi
      .spyOn(client, 'cancelQueries')
      .mockImplementationOnce(() => cancelled.promise);
    const finalRepository = {
      getAuthoritativeForDate: vi.fn(async (day: string) =>
        day === date ? selected() : history()
      ),
      updatePartialDetailed: vi.fn(async () => confirmedWrite(cleared(selected()))),
    };
    let settled!: Promise<unknown>;
    act(() => {
      settled = finalizeRayenHistoricalDischarges(
        applied(),
        finalRepository as never,
        client,
        false,
        A_SESSION
      ).catch(error => error);
    });
    await waitFor(() => expect(cancelQueries).toHaveBeenCalled());

    await switchToNextSession();
    await act(async () => {
      cancelled.release();
      await settled;
    });

    expect(await settled).toBeInstanceOf(Error);
    expect(await openCensus()).toEqual(B_READS_THE_DAY);
  });
});

describe('run audit (useRayenSyncAudit)', () => {
  it('a run that fails after the session changed records nothing in the next session', async () => {
    const patchDailyRecord = vi.fn(async () => ({
      result: confirmedWrite(recordOf(date, A_NOTE)),
    }));
    const audit = renderHook(
      () =>
        useRayenSyncAudit({
          currentRecordRef: { current: recordOf(date, A_NOTE) },
          patchDailyRecord,
          actor: run.by,
        }),
      { wrapper }
    ).result;
    const started = audit.current.startRun();

    await switchToNextSession();
    await act(async () => {
      await audit.current.failRun('apply_failed', started.id, new Error('synthetic failure'));
    });

    expect(patchDailyRecord).not.toHaveBeenCalled();
  });
});

describe('run audit queued behind other work (useRayenSyncAudit + the persistence queue)', () => {
  it('a failure that runs after the session changed leaves no history, warning or event', async () => {
    const patchDailyRecord = vi.fn();
    const audit = renderHook(
      () =>
        useRayenSyncAudit({
          currentRecordRef: { current: recordOf(date, A_NOTE) },
          patchDailyRecord,
          actor: run.by,
        }),
      { wrapper }
    ).result;
    const queue = createRayenSyncPersistenceQueue();
    const earlierWrite = held<void>();
    const first = queue.run(() => earlierWrite.promise);
    const started = audit.current.startRun();
    const failed = queue.run(() => audit.current.failRun('apply_failed', started.id));

    await switchToNextSession();
    vi.mocked(recordOperationalTelemetry).mockClear();
    await act(async () => {
      earlierWrite.release();
      await first;
      await failed;
    });

    // Before the fix: one rayen_sync_run / failed event for A's run in B's session.
    expect(patchDailyRecord).not.toHaveBeenCalled();
    expect(recordOperationalTelemetry).not.toHaveBeenCalled();
  });

  it('a completion that runs after the session changed leaves no history or event', async () => {
    const patchDailyRecord = vi.fn();
    const audit = renderHook(
      () =>
        useRayenSyncAudit({
          currentRecordRef: { current: recordOf(date, A_NOTE) },
          patchDailyRecord,
          actor: run.by,
        }),
      { wrapper }
    ).result;
    const started = audit.current.startRun();
    const applied = audit.current.applyRunToRecord(recordOf(date, A_NOTE), emptyDiff()).record;
    const queue = createRayenSyncPersistenceQueue();
    const earlierWrite = held<void>();
    const first = queue.run(() => earlierWrite.promise);
    const completed = queue
      .run(() =>
        audit.current.completeRun(applied, { total: 0, patched: 0, errors: [] }, null, started.id)
      )
      .catch(error => error);

    await switchToNextSession();
    vi.mocked(recordOperationalTelemetry).mockClear();
    await act(async () => {
      earlierWrite.release();
      await first;
      await completed;
    });

    expect(patchDailyRecord).not.toHaveBeenCalled();
    expect(recordOperationalTelemetry).not.toHaveBeenCalled();
  });

  it('the same session still records its failure', async () => {
    const patchDailyRecord = vi.fn(async () => ({
      result: confirmedWrite(recordOf(date, A_NOTE)),
    }));
    const audit = renderHook(
      () =>
        useRayenSyncAudit({
          currentRecordRef: { current: recordOf(date, A_NOTE) },
          patchDailyRecord,
          actor: run.by,
        }),
      { wrapper }
    ).result;
    const started = audit.current.startRun();
    vi.mocked(recordOperationalTelemetry).mockClear();

    await act(async () => {
      await audit.current.failRun('apply_failed', started.id);
    });

    expect(patchDailyRecord).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(recordOperationalTelemetry).mock.calls.map(([event]) => event.operation)
    ).toContain('rayen_sync_run');
  });
});
