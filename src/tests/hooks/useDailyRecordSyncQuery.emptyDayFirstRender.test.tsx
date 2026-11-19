import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { subscribeToRecord } from '@/services/storage/firestore/firestoreRecordQueries';
import { createNotFoundDailyRecordReadResult } from '@/services/repositories/dailyRecordReadResultController';
import {
  createDailyRecordReadResult,
  type DailyRecordReadResult,
} from '@/services/repositories/contracts/dailyRecordQueries';
import { readDailyRecordQuery } from '@/tests/utils/readDailyRecordQuery';
import { getDailyRecordQueryKey } from '@/hooks/controllers/dailyRecordQueryController';

// The real port, repository subscription and query controller; only the Firestore SDK
// listener, the local database and the server read are synthetic.
vi.unmock('@/application/ports/dailyRecordPort');
const mocks = vi.hoisted(() => ({ subscribe: vi.fn(), getLocal: vi.fn(async () => null) }));
let repository: DailyRecordRepositoryPort;
vi.mock('@/services/RepositoryContext', () => ({
  useRepositories: () => ({ dailyRecord: repository }),
}));
vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));
vi.mock('@/services/repositories/repositoryConfig', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/repositories/repositoryConfig')>()),
  isFirestoreEnabled: () => true,
  getFirestoreSyncState: () => ({ mode: 'enabled' }),
}));
vi.mock('@/services/repositories/dailyRecordOperationalTelemetry', () => ({
  dailyRecordObservability: { recordOutcome: vi.fn(), recordError: vi.fn(), recordEvent: vi.fn() },
}));
vi.mock('@/services/storage/firestore/firestoreRecordQueries', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/storage/firestore/firestoreRecordQueries')>()),
  subscribeToRecord: mocks.subscribe,
}));
vi.mock('@/services/storage/indexeddb/indexedDbRecordService', () => ({
  getRecordForDateStrict: mocks.getLocal,
  captureLocalRecordBase: async () => ({ kind: 'stored', record: null }),
  inspectLocalRecordAdmission: async (_date: string, base: { record: unknown }) => ({
    status: 'admitted',
    record: base.record,
  }),
}));
vi.mock('@/services/repositories/dailyRecordServerAbsence', () => ({
  confirmDailyRecordMissingOnServer: async () => {},
}));
vi.mock('@/utils/dateCoreUtils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/dateCoreUtils')>()),
  getTodayISO: () => '2026-11-15',
}));

const date = '2026-11-15';
type SdkEmit = Parameters<typeof subscribeToRecord>[1];
type SdkError = NonNullable<Parameters<typeof subscribeToRecord>[2]>;
const fromCache = { fromCache: true, hasPendingWrites: false };
const fromServer = { fromCache: false, hasPendingWrites: false };
const confirmedMissing = (): DailyRecordReadResult => ({
  ...createNotFoundDailyRecordReadResult(date, 'missing'),
  serverConfirmed: true,
});
const unavailable = (): DailyRecordReadResult =>
  createDailyRecordReadResult(date, null, 'not_found', {
    consistencyState: 'unavailable',
    sourceOfTruth: 'none',
    retryability: 'automatic_retry',
    recoveryAction: 'defer_remote_sync',
  });

const settle = async () => {
  await act(async () => {
    await vi.dynamicImportSettled();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);
  });
};

/** Opens the day as CensusView does and records what every render would hand it. */
const openDay = async (
  remoteRead: () => Promise<DailyRecordReadResult>,
  seed?: (client: QueryClient) => Promise<void>
) => {
  let sdkEmit: SdkEmit = () => {
    throw new Error('listener not installed');
  };
  let sdkError: SdkError = () => {};
  mocks.subscribe.mockImplementation((_date: string, emit: SdkEmit, onError: SdkError) => {
    sdkEmit = emit;
    sdkError = onError;
    return () => {};
  });
  const port = (await import('@/application/ports/dailyRecordPort'))
    .defaultDailyRecordRepositoryPort;
  repository = {
    ...port,
    getForDateWithMeta: vi.fn(async (_date: string, syncFromRemote?: boolean) =>
      syncFromRemote === false
        ? createNotFoundDailyRecordReadResult(date, 'not_requested')
        : remoteRead()
    ),
    syncWithFirestoreDetailed: vi.fn(async () => null),
  } as DailyRecordRepositoryPort;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await seed?.(client);
  const renders: Array<{ bootstrapPhase: string; syncStatus: string }> = [];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    () => {
      const state = useDailyRecordSyncQuery(date, 'ready');
      renders.push({ bootstrapPhase: state.bootstrapPhase, syncStatus: state.syncStatus });
      return state;
    },
    { wrapper }
  );
  await settle();
  return {
    client,
    view,
    /** Renders in which CensusView mounts the amber «No se pudo comprobar…» box. */
    failureRenders: () =>
      renders.filter(
        ({ bootstrapPhase, syncStatus }) =>
          syncStatus === 'error' || bootstrapPhase === 'remote_record_timeout'
      ),
    emit: async (metadata: typeof fromCache) => {
      await act(async () => sdkEmit(null, false, metadata));
      await settle();
    },
    failListener: async () => {
      await act(async () => sdkError(new Error('synthetic listener failure')));
      await settle();
    },
  };
};

describe('opening a day without census', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    mocks.subscribe.mockReset();
  });

  it.each([
    ['cold start', undefined],
    [
      'a day already confirmed empty earlier in the session',
      async (client: QueryClient) => {
        client.setQueryData(
          getDailyRecordQueryKey(date),
          await readDailyRecordQuery({ getForDateWithMeta: async () => confirmedMissing() }, date)
        );
      },
    ],
  ])(
    'never reports a failed check while Firestore answers from its cache first (%s)',
    async (_case, seed) => {
      let answerServer!: (read: DailyRecordReadResult) => void;
      const day = await openDay(
        () =>
          new Promise(resolve => {
            answerServer = resolve;
          }),
        seed
      );
      // The SDK's persistent cache knows this target, so the listener answers from cache first.
      await day.emit(fromCache);
      await day.emit(fromServer);
      answerServer(confirmedMissing());
      await settle();

      expect(day.view.result.current.bootstrapPhase).toBe('confirmed_empty');
      expect(day.failureRenders()).toEqual([]);
      day.client.clear();
    }
  );

  it('still reports a real failure to read this date', async () => {
    const day = await openDay(async () => unavailable());
    await day.emit(fromCache);

    expect(day.view.result.current.bootstrapPhase).toBe('remote_record_timeout');
    expect(day.failureRenders().length).toBeGreaterThan(0);
    day.client.clear();
  });

  it('still reports a failed live listener for this date', async () => {
    let answerServer!: (read: DailyRecordReadResult) => void;
    const day = await openDay(
      () =>
        new Promise(resolve => {
          answerServer = resolve;
        })
    );
    await day.failListener();

    expect(day.view.result.current.bootstrapPhase).toBe('remote_record_timeout');
    answerServer(unavailable());
    day.client.clear();
  });
});
