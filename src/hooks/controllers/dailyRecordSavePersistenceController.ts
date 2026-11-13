import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { SaveDailyRecordOptions } from '@/services/repositories/contracts/dailyRecordCommands';
import type { SaveDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { SaveDailyRecordMutationInput } from './dailyRecordMutationFreshnessController';

export const saveDailyRecordWithCompatibility = async (
  dailyRecord: DailyRecordRepositoryPort,
  record: DailyRecord,
  expectedLastUpdated: string = record.lastUpdated,
  options: SaveDailyRecordOptions
): Promise<SaveDailyRecordResult | null> => {
  if (typeof dailyRecord.saveDetailed === 'function') {
    return dailyRecord.saveDetailed(record, expectedLastUpdated, options);
  }
  await dailyRecord.save(record, expectedLastUpdated, options);
  return null;
};

export const persistDailyRecordSaveMutation = async (
  dailyRecord: DailyRecordRepositoryPort,
  input: SaveDailyRecordMutationInput
) => {
  const { record, expectedLastUpdated: version, ...options } = input;
  const result = await saveDailyRecordWithCompatibility(dailyRecord, record, version, options);
  return { record: result?.confirmedRecord ?? record, result };
};
