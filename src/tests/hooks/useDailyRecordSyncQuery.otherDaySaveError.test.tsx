import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { createNotFoundDailyRecordReadResult } from '@/services/repositories/dailyRecordReadResultController';
import { createDailyRecordReadResult } from '@/services/repositories/contracts/dailyRecordQueries';
import type { DailyRecordReadResult } from '@/services/repositories/contracts/dailyRecordQueries';
import type { DailyRecord } from '@/types/domain/dailyRecord';

// The real port, repository subscription, query controller and save mutation; only the Firestore
// SDK listener, the local database, the server read and the refused write are synthetic.
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
// A whole-record save of the previous day (a discharge, a transfer) that the server refuses.
vi.mock('@/hooks/controllers/dailyRecordMutationFreshnessController', async importOriginal => ({
  ...(await importOriginal<
    typeof import('@/hooks/controllers/dailyRecordMutationFreshnessController')
  >()),
  ensureFreshDailyRecordSaveMutation: async () => {},
}));
vi.mock('@/hooks/controllers/dailyRecordSavePersistenceController', () => ({
  persistDailyRecordSaveMutation: async () => {
    throw new Error('synthetic refused save');
  },
}));

const previousDay = '2026-11-14';
const emptyDay = '2026-11-15';
const previousRecord = { date: previousDay, beds: {} } as unknown as DailyRecord;

const settle = async () => {
  await act(async () => {
    await vi.dynamicImportSettled();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(50);
  });
};

describe('opening a day without census after a save of another day failed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    mocks.subscribe.mockReset();
  });

  it('does not report a failed check while the empty day is still being read', async () => {
    mocks.subscribe.mockImplementation(() => () => {});
    const port = (await import('@/application/ports/dailyRecordPort'))
      .defaultDailyRecordRepositoryPort;
    repository = {
      ...port,
      getForDateWithMeta: vi.fn(async (date: string, syncFromRemote?: boolean) => {
        if (date === previousDay)
          return createDailyRecordReadResult(previousDay, previousRecord, 'firestore', {
            serverConfirmed: true,
          });
        if (syncFromRemote === false)
          return createNotFoundDailyRecordReadResult(date, 'not_requested');
        // The server has not answered for the empty day yet.
        return new Promise<DailyRecordReadResult>(() => {});
      }),
      syncWithFirestoreDetailed: vi.fn(async () => null),
    } as DailyRecordRepositoryPort;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const renders: Array<{ date: string; bootstrapPhase: string; syncStatus: string }> = [];
    const view = renderHook(
      ({ date }: { date: string }) => {
        const state = useDailyRecordSyncQuery(date, 'ready');
        renders.push({ date, bootstrapPhase: state.bootstrapPhase, syncStatus: state.syncStatus });
        return state;
      },
      { wrapper, initialProps: { date: previousDay } }
    );
    await settle();

    await act(async () => {
      await view.result.current.saveAndUpdate(previousRecord).catch(() => undefined);
    });
    await settle();
    expect(view.result.current.syncStatus).toBe('error');

    view.rerender({ date: emptyDay });
    await settle();

    // CensusView mounts the amber «No se pudo comprobar si existe un censo» box only for a failed
    // read of the date it shows (phase 'remote_record_timeout'); the refused save of the previous
    // day still reports 'error' here, and CensusView.test.tsx proves that alone opens no box.
    const emptyDayRenders = renders.filter(render => render.date === emptyDay);
    expect(emptyDayRenders.length).toBeGreaterThan(0);
    expect(emptyDayRenders.every(render => render.bootstrapPhase !== 'confirmed_empty')).toBe(true);
    expect(
      emptyDayRenders.filter(({ bootstrapPhase }) => bootstrapPhase === 'remote_record_timeout')
    ).toEqual([]);
    client.clear();
  });
});
