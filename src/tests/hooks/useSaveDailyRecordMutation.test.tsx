import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSaveDailyRecordMutation } from '@/hooks/useDailyRecordQuery';
import {
  getDailyRecordQueryKey,
  setDailyRecordQueryData,
} from '@/hooks/controllers/dailyRecordQueryController';
import { setRemoteConfirmedDailyRecordQueryData } from '@/hooks/controllers/dailyRecordConfirmedCacheController';
import { resetDailyRecordFreshnessGateForTests } from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { RepositoryProvider, createRepositoryContainer } from '@/services/RepositoryContext';
import {
  createSaveDailyRecordResult,
  type SaveDailyRecordResult,
} from '@/services/repositories/contracts/dailyRecordResults';
import type { DailyRecordQueryResult } from '@/services/repositories/contracts/dailyRecordQueries';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { DataFactory } from '@/tests/factories/DataFactory';
import { buildMockDailyRecordRepository } from '@/tests/factories/dailyRecordRepositoryMock';
import { createTestQueryClient } from '@/tests/utils/queryClientTestUtils';

const date = '2026-10-27';
const record = () =>
  DataFactory.createMockDailyRecord(date, {
    beds: {},
    lastUpdated: `${date}T10:00:00.000Z`,
    nursesDayShift: ['SYNTHETIC A'],
    tensDayShift: [],
  });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
};

const startSave = async () => {
  const client = createTestQueryClient();
  const repository = buildMockDailyRecordRepository();
  const entered = deferred<void>();
  const response = deferred<SaveDailyRecordResult>();
  vi.mocked(repository.saveDetailed).mockImplementation(() => {
    entered.resolve();
    return response.promise;
  });
  const repositories = createRepositoryContainer({ dailyRecord: repository });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <RepositoryProvider value={repositories}>{children}</RepositoryProvider>
    </QueryClientProvider>
  );
  const { result } = renderHook(() => useSaveDailyRecordMutation(), { wrapper });
  let pending!: ReturnType<typeof result.current.mutateAsync>;
  await act(async () => {
    pending = result.current.mutateAsync({ record: record(), rayenStructuralWriteGuard: true });
    await entered.promise;
  });
  const finish = async (confirmedRecord: DailyRecord, localProjectionRecord?: DailyRecord) => {
    await act(async () => {
      response.resolve(
        createSaveDailyRecordResult({
          date,
          outcome: 'clean',
          savedLocally: true,
          savedRemotely: true,
          queuedForRetry: false,
          autoMerged: false,
          confirmedRecord,
          localProjectionRecord,
        })
      );
      await pending;
    });
    return client.getQueryData<DailyRecordQueryResult>(getDailyRecordQueryKey(date));
  };
  return { client, finish, pending };
};

describe('full-save mutation acknowledgement', () => {
  beforeEach(() => resetDailyRecordFreshnessGateForTests());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each(['09', '10', '11'])(
    'publishes retained B as local with timestamp %s and no B in this tab',
    async hour => {
      const { finish, pending } = await startSave();
      const confirmed = { ...record(), nursesDayShift: ['NORMALIZED A'] };
      const retained = {
        ...record(),
        tensDayShift: ['SYNTHETIC B'],
        lastUpdated: `${date}T${hour}:00:00.000Z`,
      };
      expect(await finish(confirmed, retained)).toMatchObject({
        record: retained,
        runtime: { sourceOfTruth: 'local', consistencyState: 'local_only' },
      });
      expect((await pending).record).toEqual(confirmed);
    }
  );

  it.each([false, true])(
    'preserves C published while the ACK is in flight, retained B=%s',
    async withB => {
      const { client, finish } = await startSave();
      const c = {
        ...record(),
        tensDayShift: withB ? ['SYNTHETIC B'] : [],
        tensNightShift: ['SYNTHETIC C'],
      };
      setDailyRecordQueryData(client, date, c);
      const b = { ...record(), tensDayShift: ['SYNTHETIC B'] };
      expect(await finish(record(), withB ? b : undefined)).toMatchObject({
        record: c,
        runtime: { sourceOfTruth: 'local' },
      });
    }
  );

  it('preserves same-millisecond C that arrives while cancelling an old query before ACK publication', async () => {
    const { client, finish } = await startSave();
    const c = { ...record(), tensNightShift: ['SYNTHETIC C'] };
    const cancel = client.cancelQueries.bind(client);
    vi.spyOn(client, 'cancelQueries').mockImplementationOnce(async filters => {
      await cancel(filters);
      setDailyRecordQueryData(client, date, c);
    });
    expect(await finish(record(), { ...record(), tensDayShift: ['SYNTHETIC B'] })).toMatchObject({
      record: c,
      runtime: { sourceOfTruth: 'local' },
    });
  });

  it('publishes retained work even when this tab received A from the server in the meantime', async () => {
    const { client, finish } = await startSave();
    const confirmed = {
      ...record(),
      nursesDayShift: ['NORMALIZED A'],
      lastUpdated: `${date}T11:00:00.000Z`,
    };
    await setRemoteConfirmedDailyRecordQueryData(client, date, confirmed);
    const retained = { ...record(), tensDayShift: ['SYNTHETIC B'] };
    expect(await finish(confirmed, retained)).toMatchObject({
      record: retained,
      runtime: { sourceOfTruth: 'local', consistencyState: 'local_only' },
    });
  });

  it('adopts normalized A when no intervening edit is pending', async () => {
    const { finish } = await startSave();
    const confirmed = { ...record(), nursesDayShift: ['NORMALIZED A'] };
    expect(await finish(confirmed)).toMatchObject({
      record: confirmed,
      runtime: { sourceOfTruth: 'remote', consistencyState: 'remote_authoritative' },
    });
  });
});
