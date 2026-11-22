import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDailyRecordQuery } from '@/hooks/useDailyRecordQuery';
import { usePatchDailyRecordMutation } from '@/hooks/usePatchDailyRecordMutation';
import {
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import {
  getDailyRecordLastRemoteConfirmedAt,
  resetDailyRecordFreshnessGateForTests,
} from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { clearPendingDailyRecordPatchesForTests } from '@/hooks/controllers/dailyRecordPendingPatchController';
import type { DailyRecordWriteResult } from '@/services/repositories/contracts/dailyRecordResults';
import { RepositoryProvider, createRepositoryContainer } from '@/context/RepositoryContext';
import {
  clearSessionScopedClientState,
  reconcileAuthorizedSessionOwner,
} from '@/services/session/sessionScopedStorageService';
import {
  SESSION_GENERATION_KEY,
  setSessionGeneration,
} from '@/services/session/sessionStorageTransition';
import { SESSION_OWNER_KEY } from '@/services/session/sessionOwnerKey';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import { DataFactory } from '@/tests/factories/DataFactory';
import type { DailyRecord } from '@/types/domain/dailyRecord';

vi.mock('@/services/observability/operationalTelemetryRecorder', () => ({
  recordOperationalTelemetry: vi.fn(),
}));

/**
 * W14-H3 — a census edit whose answer arrives after its session ended must not touch the next
 * session's census cache. Logout clears the query cache (useAuthState.ts, clearQueryCache); a
 * late rollback or acknowledgement used to write the departing person's census back into it,
 * and the next person's reader showed it without reading. The hook and the census reader are
 * the shipped ones; only the repository's answer is scripted.
 */
const date = '2026-11-17';
const NOTE = 'handoffNovedadesNightShift' as const;
const BEFORE = 'NOCHE SINTETICA A';
const EDIT = 'EDICION SINTETICA A';
const NEXT = 'NOCHE SINTETICA B';
const patch = { [NOTE]: EDIT };
// Server-first with the edit shown at once: the census's crib creation uses these options.
const optimisticServerFirst = {
  requireRemoteAuthorityFirst: true,
  requireConfirmedRecord: true,
  requireAtomicCas: true,
  optimisticRemoteConfirmed: true,
};

const recordWith = (note: string): DailyRecord => ({
  ...DataFactory.createMockDailyRecord(date),
  [NOTE]: note,
});
const readOf = (record: DailyRecord | null) => ({
  date,
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
type Answer = 'rejected' | 'confirmed' | 'thrown';
const answerOf = (answer: Answer): DailyRecordWriteResult => {
  if (answer === 'thrown') throw new Error('synthetic network failure');
  return answer === 'rejected'
    ? {
        date,
        savedHere: false,
        state: 'not_saved',
        reason: 'local_failed',
      }
    : {
        date,
        savedHere: true,
        state: 'confirmed',
        localCopy: 'current',
        confirmedRecord: recordWith(EDIT),
      };
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
// Answers still held when a case ends; released so no edit keeps the date's turn.
let held: Array<{ release: () => void; settled: Promise<unknown> }> = [];
const shown = () =>
  client.getQueryData<{ record: DailyRecord | null }>(getDailyRecordQueryKey(date))?.record?.[NOTE];

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
  // The app's query defaults: a read census stays fresh for five minutes.
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 5 * 60 * 1000 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  repository = buildMockDailyRecordRepository();
  vi.mocked(repository.getForDateWithMeta).mockResolvedValue(readOf(recordWith(NEXT)));
  const container = createRepositoryContainer({ dailyRecord: repository });
  wrapper = ({ children }) => (
    <QueryClientProvider client={client}>
      <RepositoryProvider value={container}>{children}</RepositoryProvider>
    </QueryClientProvider>
  );
});
afterEach(async () => {
  await act(async () => {
    held.forEach(({ release }) => release());
    await Promise.all(held.map(({ settled }) => settled));
  });
  held = [];
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

/** A's edit shows at once; its answer is held until the session has changed. */
const sendHeldEdit = async () => {
  setDailyRecordQueryData(client, date, recordWith(BEFORE));
  let answer!: (kind: Answer) => void;
  vi.mocked(repository.updatePartialDetailed).mockImplementation(
    () =>
      new Promise<DailyRecordWriteResult>((resolve, reject) => {
        answer = kind => {
          try {
            resolve(answerOf(kind));
          } catch (error) {
            reject(error);
          }
        };
      })
  );
  const { result } = renderHook(() => usePatchDailyRecordMutation(date), { wrapper });
  let settled!: Promise<unknown>;
  act(() => {
    settled = result.current
      .mutateAsync({ date, partial: patch, options: optimisticServerFirst })
      .catch(error => error);
  });
  held.push({ release: () => answer('rejected'), settled });
  await waitFor(() => expect(repository.updatePartialDetailed).toHaveBeenCalledTimes(1));
  expect(shown()).toBe(EDIT);
  return {
    answer: async (kind: Answer) => {
      await act(async () => {
        answer(kind);
        await settled;
      });
    },
  };
};

/** The next person's census opens the day with the shipped reader. */
const openCensus = async () => {
  const readsBefore = vi.mocked(repository.getForDateWithMeta).mock.calls.length;
  const reader = renderHook(() => useDailyRecordQuery(date, false, 'local_only'), { wrapper });
  await waitFor(() => expect(reader.result.current.isFetching).toBe(false));
  return {
    rendered: reader.result.current.data?.[NOTE],
    reads: vi.mocked(repository.getForDateWithMeta).mock.calls.length - readsBefore,
  };
};

describe('a late answer after the session changed leaves the next session alone', () => {
  it.each<Answer>(['rejected', 'thrown', 'confirmed'])(
    '%s: the next session starts from an empty cache and its reader reads the day',
    async kind => {
      const edit = await sendHeldEdit();
      await switchToNextSession();
      expect(shown()).toBeUndefined();

      await edit.answer(kind);

      // Before the fix: { rendered: A's census, reads: 0 } — B saw what A had on screen.
      expect(await openCensus()).toEqual({ rendered: NEXT, reads: 1 });
      expect(getDailyRecordLastRemoteConfirmedAt(date)).toBeUndefined();
    }
  );

  it.each<Answer>(['rejected', 'thrown', 'confirmed'])(
    '%s: the next session keeps the census it already loaded',
    async kind => {
      const edit = await sendHeldEdit();
      await switchToNextSession();
      setDailyRecordQueryData(client, date, recordWith(NEXT));

      await edit.answer(kind);

      expect(shown()).toBe(NEXT);
    }
  );

  it('an edit that waited for its turn across the change shows nothing to the next session', async () => {
    const first = await sendHeldEdit();
    const { result } = renderHook(() => usePatchDailyRecordMutation(date), { wrapper });
    let second!: Promise<unknown>;
    let answerSecond: (() => void) | undefined;
    act(() => {
      second = result.current
        .mutateAsync({
          date,
          partial: { [NOTE]: 'SEGUNDA EDICION A' },
          options: optimisticServerFirst,
        })
        .catch(error => error);
    });
    held.push({ release: () => answerSecond?.(), settled: second });
    await switchToNextSession();
    setDailyRecordQueryData(client, date, recordWith(NEXT));
    vi.mocked(repository.updatePartialDetailed).mockImplementation(
      () =>
        new Promise<DailyRecordWriteResult>(resolve => {
          answerSecond = () => resolve(answerOf('rejected'));
        })
    );

    await first.answer('rejected');
    await waitFor(() => expect(repository.updatePartialDetailed).toHaveBeenCalledTimes(2));
    // While A's second edit is on its way, B's census is not painted with it.
    expect(shown()).toBe(NEXT);
    await act(async () => {
      answerSecond?.();
      await second;
    });

    expect(shown()).toBe(NEXT);
  });
});

describe('the same session still sees its answer', () => {
  it.each<[Answer, string]>([
    ['rejected', BEFORE],
    ['thrown', BEFORE],
    ['confirmed', EDIT],
  ])('%s: the census shows %s', async (kind, expected) => {
    const edit = await sendHeldEdit();
    await edit.answer(kind);
    expect(shown()).toBe(expected);
  });
});

describe('the session ends while the edit waits for running reads to stop', () => {
  it('a confirmation that was waiting does not repopulate the next reader', async () => {
    const edit = await sendHeldEdit();
    const cancelQueries = client.cancelQueries.bind(client);
    vi.spyOn(client, 'cancelQueries').mockImplementationOnce(async (...args) => {
      await cancelQueries(...args);
      await switchToNextSession();
    });

    await edit.answer('confirmed');

    // Before the second check: { rendered: A's edit, reads: 0 }.
    expect(await openCensus()).toEqual({ rendered: NEXT, reads: 1 });
  });

  it('an edit that was about to show is not painted over the next census', async () => {
    setDailyRecordQueryData(client, date, recordWith(BEFORE));
    const cancelQueries = client.cancelQueries.bind(client);
    vi.spyOn(client, 'cancelQueries').mockImplementationOnce(async (...args) => {
      await cancelQueries(...args);
      await switchToNextSession();
      setDailyRecordQueryData(client, date, recordWith(NEXT));
    });
    vi.mocked(repository.updatePartialDetailed).mockResolvedValue(answerOf('rejected'));
    const { result } = renderHook(() => usePatchDailyRecordMutation(date), { wrapper });

    await act(async () => {
      await result.current
        .mutateAsync({ date, partial: patch, options: optimisticServerFirst })
        .catch(error => error);
    });

    expect(shown()).toBe(NEXT);
  });
});
