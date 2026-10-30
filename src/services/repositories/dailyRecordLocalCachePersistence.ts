import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  saveRecordStrict as saveToIndexedDB,
  type LocalRecordWriteResult,
  type LocalRecordBase,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import { prepareDailyRecordForPersistence } from '@/services/repositories/dailyRecordPersistencePreparation';

const toLocalPersistenceError = (result: LocalRecordWriteResult): Error =>
  result.error instanceof Error
    ? result.error
    : new Error(result.userSafeMessage || 'No fue posible guardar el registro local hidratado.');

/**
 * Local cache hydration must respect the same record invariants and admission
 * date policy used by repository writes. This keeps remote/legacy hydration from
 * silently reintroducing invalid critical fields into IndexedDB.
 */
export const persistHydratedRecordToLocalCache = async (
  record: DailyRecord,
  date: string,
  previousRecord?: DailyRecord | null
): Promise<DailyRecord> => {
  const validatedRecord = prepareDailyRecordForPersistence(record, date, previousRecord);
  const result = await saveToIndexedDB(validatedRecord, { preserveUnresolvedWrites: true });
  if (!result.ok) {
    throw toLocalPersistenceError(result);
  }
  return result.retainedRecord ?? validatedRecord;
};

export type PointReadHydration =
  | { status: 'written' | 'retained_pending'; record: DailyRecord }
  | { status: 'superseded'; stored: DailyRecord | null };

export const persistPointReadToLocalCache = async (
  record: DailyRecord,
  date: string,
  base: LocalRecordBase,
  previousRecord: DailyRecord | null
): Promise<PointReadHydration> => {
  const validatedRecord = prepareDailyRecordForPersistence(record, date, previousRecord);
  const result = await saveToIndexedDB(validatedRecord, {
    preserveUnresolvedWrites: true,
    expectedBase: base,
  });
  if (!result.ok) throw toLocalPersistenceError(result);
  if (result.superseded) return { status: 'superseded', stored: result.superseded.stored };
  return result.retainedRecord
    ? { status: 'retained_pending', record: result.retainedRecord }
    : { status: 'written', record: validatedRecord };
};
