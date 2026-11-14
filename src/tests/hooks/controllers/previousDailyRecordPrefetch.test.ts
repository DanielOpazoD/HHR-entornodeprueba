import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  getDailyRecordQueryKey,
  prefetchPreviousDailyRecord,
} from '@/hooks/controllers/dailyRecordQueryController';
import { createDailyRecordReadResult } from '@/services/repositories/contracts/dailyRecordQueries';
import { DataFactory } from '@/tests/factories/DataFactory';

const originalTimezone = process.env.TZ;
afterEach(() => {
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

const dates: [string, string][] = Array.from({ length: 730 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 0, 1 + index));
  const previous = new Date(Date.UTC(2026, 0, index));
  return [date.toISOString().slice(0, 10), previous.toISOString().slice(0, 10)];
});
dates.unshift(['2026-11-12', '2026-11-11'], ['2025-01-08', '2025-01-07']);
dates.push(['2028-02-29', '2028-02-28'], ['2028-03-01', '2028-02-29']);

describe.each([
  'UTC',
  'America/Santiago',
  'Pacific/Easter',
  'Pacific/Auckland',
  'Pacific/Pago_Pago',
  'Pacific/Kiritimati',
])('previous census prefetch in %s', timezone => {
  it('reads and caches the immediately preceding calendar day throughout 2026 and 2027', async () => {
    process.env.TZ = timezone;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const getForDateWithMeta = vi.fn(async (date: string) =>
      createDailyRecordReadResult(date, DataFactory.createMockDailyRecord(date), 'indexeddb')
    );
    try {
      for (const [date, previous] of dates) {
        await prefetchPreviousDailyRecord(queryClient, { getForDateWithMeta }, date);
        expect(getForDateWithMeta, `${timezone}: ${date}`).toHaveBeenLastCalledWith(previous, true);
        expect(queryClient.getQueryData(getDailyRecordQueryKey(previous))).toMatchObject({
          record: { date: previous },
        });
        queryClient.clear();
      }
    } finally {
      queryClient.clear();
    }
  });
});
