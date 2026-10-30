import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { DataFactory } from '@/tests/factories/DataFactory';
import {
  createDailyRecordReadResult,
  type DailyRecordQueryResult,
} from '@/services/repositories/contracts/dailyRecordQueries';
import { createSyncDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import {
  createDailyRecordSubscription,
  createDailyRecordQueryOptions,
  getDailyRecordQueryKey,
} from '@/hooks/controllers/dailyRecordQueryController';
import { resetDailyRecordFreshnessGateForTests } from '@/hooks/controllers/dailyRecordFreshnessGateController';
import { clearPendingDailyRecordPatchesForTests } from '@/hooks/controllers/dailyRecordPendingPatchController';

vi.mock('@/services/repositories/dailyRecordOperationalTelemetry', () => ({
  dailyRecordObservability: { recordEvent: vi.fn(), recordError: vi.fn() },
}));

const date = '2026-10-29';
const queryKey = getDailyRecordQueryKey(date);
type Subscriber = Parameters<typeof createDailyRecordSubscription>[0]['subscribeDetailed'];
type Deliver = Parameters<Subscriber>[1];

describe('point read publication at the QueryClient boundary', () => {
  let client: QueryClient;
  let stop = () => {};

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    resetDailyRecordFreshnessGateForTests();
    clearPendingDailyRecordPatchesForTests();
  });

  afterEach(() => {
    stop();
    client.clear();
    resetDailyRecordFreshnessGateForTests();
    clearPendingDailyRecordPatchesForTests();
  });

  it.each([false, true])(
    'publishes the read unless a subscription commits before framework setData: concurrent %s',
    async concurrent => {
      const recordA = DataFactory.createMockDailyRecord(date, {
        lastUpdated: '2026-10-29T12:00:00.000Z',
        nursesDayShift: ['ENFERMERA SINTETICA A'],
      });
      const recordB = { ...recordA, nursesDayShift: ['ENFERMERA SINTETICA B'] };
      const reader = {
        getForDateWithMeta: vi.fn(async () =>
          createDailyRecordReadResult(date, recordA, 'firestore', { serverConfirmed: true })
        ),
      };
      let deliver: Deliver = () => {
        throw new Error('The subscription must be installed before delivering B.');
      };
      stop = createDailyRecordSubscription(
        {
          ...reader,
          subscribeDetailed: (_requestedDate, callback) => {
            deliver = callback;
            return () => {};
          },
        },
        date,
        client
      );
      const options = createDailyRecordQueryOptions(reader, date, client);
      const reconciledQuery = options.queryFn;
      let deliveredB = false;
      await client.fetchQuery({
        ...options,
        staleTime: 0,
        queryFn: context => {
          const result = reconciledQuery(context);
          if (concurrent) {
            void result.then(() => {
              deliver(
                createSyncDailyRecordResult({
                  date,
                  record: recordB,
                  outcome: 'clean',
                  serverConfirmed: true,
                  sourceOfTruth: 'remote',
                  consistencyState: 'remote_applied',
                }),
                false
              );
              deliveredB = true;
            });
          }
          return result;
        },
      });

      expect(deliveredB).toBe(concurrent);
      expect(client.getQueryData<DailyRecordQueryResult>(queryKey)?.record?.nursesDayShift).toEqual(
        concurrent ? recordB.nursesDayShift : recordA.nursesDayShift
      );
      expect(client.getQueryData<DailyRecordQueryResult>(queryKey)?.runtime.serverConfirmed).toBe(
        true
      );
    }
  );
});
