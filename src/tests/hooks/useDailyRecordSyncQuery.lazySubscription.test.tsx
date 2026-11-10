import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDailyRecordSyncQuery } from '@/hooks/useDailyRecordSyncQuery';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { DataFactory } from '@/tests/factories/DataFactory';
import { createDailyRecordReadResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { getDailyRecordQueryKey } from '@/hooks/controllers/dailyRecordQueryController';

vi.unmock('@/application/ports/dailyRecordPort');
let repository: DailyRecordRepositoryPort;
vi.mock('@/services/RepositoryContext', () => ({
  useRepositories: () => ({ dailyRecord: repository }),
}));
vi.mock('@/context/UIContext', () => ({
  useNotification: () => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }),
}));
vi.mock('@/services/repositories/repositoryConfig', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/repositories/repositoryConfig')>()),
  getFirestoreSyncState: () => ({ mode: 'enabled' }),
}));
vi.mock('@/services/repositories/dailyRecordOperationalTelemetry', () => ({
  dailyRecordObservability: { recordOutcome: vi.fn(), recordError: vi.fn(), recordEvent: vi.fn() },
}));
vi.mock('@/utils/dateCoreUtils', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/dateCoreUtils')>()),
  getTodayISO: () => '2026-11-10',
}));
const date = '2026-11-10';
const flush = async () => {
  await act(async () => {
    await vi.dynamicImportSettled();
    for (let i = 0; i < 60; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
  });
};

describe('persistent lazy subscription load failure in the recovery owner', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.doUnmock('@/services/repositories/dailyRecordRepositorySyncService');
  });

  it.each([false, true])(
    'bounds recovery and retains the visible census (loaded=%s)',
    async loaded => {
      vi.useFakeTimers();
      vi.resetModules();
      let loads = 0;
      vi.doMock('@/services/repositories/dailyRecordRepositorySyncService', () => {
        loads++;
        throw new Error('synthetic persistent chunk failure');
      });
      const port = (await import('@/application/ports/dailyRecordPort'))
        .defaultDailyRecordRepositoryPort;
      const record = loaded ? DataFactory.createMockDailyRecord(date) : null;
      const read = createDailyRecordReadResult(date, record, 'indexeddb');
      const getForDateWithMeta = vi.fn().mockResolvedValue(read);
      const sync = vi.fn(port.syncWithFirestoreDetailed);
      const subscribe = vi.fn(port.subscribeDetailed);
      repository = {
        ...port,
        getForDateWithMeta,
        subscribeDetailed: subscribe,
        syncWithFirestoreDetailed: sync,
      };
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
      });
      client.setQueryData(getDailyRecordQueryKey(date), {
        record,
        runtime: { ...read, availabilityState: loaded ? 'resolved' : 'unconfirmed_missing' },
      });
      const publications: unknown[] = [];
      const stopObserving = client
        .getQueryCache()
        .subscribe(() => publications.push(client.getQueryData(getDailyRecordQueryKey(date))));
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
      const phases: string[] = [];
      const { result, rerender, unmount } = renderHook(
        () => {
          const state = useDailyRecordSyncQuery(date, false, 'ready');
          phases.push(state.bootstrapPhase);
          return state;
        },
        { wrapper }
      );
      await flush();
      await flush();
      expect(result.current.record).toEqual(record);
      expect(phases).toContain(loaded ? 'record_ready' : 'remote_record_timeout');
      expect(publications).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            runtime: expect.objectContaining({
              availabilityState: 'temporarily_unavailable',
              consistencyState: 'blocked',
              serverConfirmed: false,
            }),
          }),
        ])
      );
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(sync).toHaveBeenCalledTimes(loaded ? 0 : 1);
      expect(loads).toBe(loaded ? 1 : 2);
      const reads = getForDateWithMeta.mock.calls.length;
      // A mounted empty day owns only one recovery attempt, even through repeated renders and elapsed time.
      for (let minute = 0; minute < 60; minute++) {
        rerender();
        await act(async () => {
          await vi.advanceTimersByTimeAsync(60_000);
        });
      }
      expect(loads).toBe(loaded ? 1 : 2);
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(sync).toHaveBeenCalledTimes(loaded ? 0 : 1);
      expect(getForDateWithMeta).toHaveBeenCalledTimes(reads);
      stopObserving();
      unmount();
      client.clear();
    }
  );
});
