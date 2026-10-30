import { QueryClient } from '@tanstack/react-query';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import { createDailyRecordQueryOptions } from '@/hooks/controllers/dailyRecordQueryController';

export const readDailyRecordQuery = async (
  reader: Pick<DailyRecordRepositoryPort, 'getForDateWithMeta'>,
  date: string,
  syncFromRemote = true
) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    return await client.fetchQuery(
      createDailyRecordQueryOptions(reader, date, client, syncFromRemote)
    );
  } finally {
    client.clear();
  }
};
