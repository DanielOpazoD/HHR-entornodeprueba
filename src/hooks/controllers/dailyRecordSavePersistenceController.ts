import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import type { DailyRecordRepositoryPort } from '@/application/ports/dailyRecordPort';
import type { SaveDailyRecordOptions } from '@/services/repositories/contracts/dailyRecordCommands';
import type { SaveDailyRecordResult } from '@/services/repositories/contracts/dailyRecordResults';
import type { SaveDailyRecordMutationInput } from './dailyRecordMutationFreshnessController';

export const saveDailyRecordWithCompatibility = async (
  dailyRecord: DailyRecordRepositoryPort,
  record: DailyRecord,
  expectedLastUpdated: string = record.lastUpdated,
  options?: SaveDailyRecordOptions
): Promise<SaveDailyRecordResult | null> => {
  if (typeof dailyRecord.saveDetailed === 'function') {
    return options
      ? dailyRecord.saveDetailed(record, expectedLastUpdated, options)
      : dailyRecord.saveDetailed(record, expectedLastUpdated);
  }

  if (options) await dailyRecord.save(record, expectedLastUpdated, options);
  else await dailyRecord.save(record, expectedLastUpdated);
  return null;
};

export const persistDailyRecordSaveMutation = async (
  dailyRecord: DailyRecordRepositoryPort,
  input: SaveDailyRecordMutationInput
) => {
  const {
    record,
    baseRecord,
    expectedLastUpdated,
    requireConfirmedRecord,
    rayenStructuralWriteGuard,
    dailyRecordWriteLease,
  } = input;
  const options =
    baseRecord || requireConfirmedRecord || rayenStructuralWriteGuard || dailyRecordWriteLease
      ? { baseRecord, requireConfirmedRecord, rayenStructuralWriteGuard, dailyRecordWriteLease }
      : undefined;
  const result = await saveDailyRecordWithCompatibility(
    dailyRecord,
    record,
    expectedLastUpdated,
    options
  );
  return { record: result?.confirmedRecord ?? record, result };
};
