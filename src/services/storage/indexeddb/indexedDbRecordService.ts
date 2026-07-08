import { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import { localPersistence } from '@/services/storage/localpersistence/localPersistenceService';
import { buildMonthRecordPrefix } from '@/services/storage/storageDateSupport';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { isE2ERuntimeEnabled } from '@/shared/runtime/e2eRuntime';

import { ensureDbReady, hospitalDB as db, isDatabaseInFallbackMode } from './indexedDbCore';
import { dispatchDailyRecordStoreChanged } from './indexedDbRecordEvents';

export type LocalRecordWriteStore = 'indexeddb' | 'fallback' | 'e2e' | 'none';

export interface LocalRecordWriteResult {
  ok: boolean;
  operation: 'save' | 'save_many' | 'delete';
  store: LocalRecordWriteStore;
  dates: string[];
  error?: unknown;
  userSafeMessage?: string;
}

const toRecordMap = (records: DailyRecord[]): Record<string, DailyRecord> => {
  const result: Record<string, DailyRecord> = {};
  for (const record of records) {
    result[record.date] = record;
  }
  return result;
};

const sortRecordsDescending = (records: DailyRecord[]): DailyRecord[] =>
  [...records].sort((a, b) => b.date.localeCompare(a.date));

const syncE2ERuntimeRecordMirror = (record: DailyRecord): void => {
  if (!isE2ERuntimeEnabled() || typeof window === 'undefined') {
    return;
  }

  localPersistence.records.save(record);
  if (window.__HHR_E2E_OVERRIDE__) {
    window.__HHR_E2E_OVERRIDE__[record.date] = record;
  }
};

const resolveActiveWriteStore = (): Exclude<LocalRecordWriteStore, 'none'> => {
  if (!isDatabaseInFallbackMode()) {
    return 'indexeddb';
  }

  return typeof window !== 'undefined' && window.__HHR_E2E_OVERRIDE__ ? 'e2e' : 'fallback';
};

const buildLocalWriteFailure = (
  operation: LocalRecordWriteResult['operation'],
  dates: string[],
  error: unknown,
  userSafeMessage: string
): LocalRecordWriteResult => ({
  ok: false,
  operation,
  store: 'none',
  dates,
  error,
  userSafeMessage,
});

export const getAllRecords = async (): Promise<Record<string, DailyRecord>> => {
  try {
    await ensureDbReady();
    if (isDatabaseInFallbackMode()) {
      return localPersistence.records.getAll();
    }
    const records = await db.dailyRecords.toArray();
    return toRecordMap(records);
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_get_all_records', error, {
      code: 'indexeddb_get_all_records_failed',
      message: 'No fue posible obtener todos los registros locales.',
      severity: 'warning',
      userSafeMessage: 'No fue posible recuperar todos los registros locales.',
    });
    return {};
  }
};

export const getRecordsForMonth = async (year: number, month: number): Promise<DailyRecord[]> => {
  try {
    await ensureDbReady();
    if (isDatabaseInFallbackMode()) {
      return sortRecordsDescending(await localPersistence.records.getRecordsForMonth(year, month));
    }
    return sortRecordsDescending(
      await db.dailyRecords.where('date').startsWith(buildMonthRecordPrefix(year, month)).toArray()
    );
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_get_records_for_month', error, {
      code: 'indexeddb_get_records_for_month_failed',
      message: `No fue posible obtener registros del mes ${year}-${month}.`,
      severity: 'warning',
      userSafeMessage: 'No fue posible recuperar registros del mes solicitado.',
      context: { year, month },
    });
    return [];
  }
};

export const getRecordsRange = async (
  startDate: string,
  endDate: string
): Promise<DailyRecord[]> => {
  try {
    await ensureDbReady();
    if (isDatabaseInFallbackMode()) {
      return localPersistence.records.getRecordsRange(startDate, endDate);
    }

    return await db.dailyRecords.where('date').between(startDate, endDate, true, true).toArray();
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_get_records_range', error, {
      code: 'indexeddb_get_records_range_failed',
      message: 'No fue posible obtener registros en el rango solicitado.',
      severity: 'warning',
      userSafeMessage: 'No fue posible recuperar registros del rango solicitado.',
      context: { startDate, endDate },
    });
    return [];
  }
};

export const getRecordForDate = async (date: string): Promise<DailyRecord | null> => {
  try {
    await ensureDbReady();

    if (isDatabaseInFallbackMode()) {
      return localPersistence.records.getForDate(date);
    }

    const record = await db.dailyRecords.get(date);
    return record || null;
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_get_record_for_date', error, {
      code: 'indexeddb_get_record_for_date_failed',
      message: `No fue posible obtener el registro del dia ${date}.`,
      severity: 'warning',
      userSafeMessage: 'No fue posible recuperar el registro solicitado.',
      context: { date },
    });
    return null;
  }
};

export const saveRecordStrict = async (record: DailyRecord): Promise<LocalRecordWriteResult> => {
  try {
    await ensureDbReady();
    const store = resolveActiveWriteStore();
    if (isDatabaseInFallbackMode()) {
      localPersistence.records.save(record);
      syncE2ERuntimeRecordMirror(record);
      dispatchDailyRecordStoreChanged({ operation: 'save', dates: [record.date] });
      return { ok: true, operation: 'save', store, dates: [record.date] };
    }
    await db.dailyRecords.put(record);
    syncE2ERuntimeRecordMirror(record);
    dispatchDailyRecordStoreChanged({ operation: 'save', dates: [record.date] });
    return { ok: true, operation: 'save', store, dates: [record.date] };
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_save_record', error, {
      code: 'indexeddb_save_record_failed',
      message: 'No fue posible guardar el registro local.',
      severity: 'error',
      userSafeMessage: 'No fue posible guardar el registro local.',
      context: { date: record.date },
    });
    return buildLocalWriteFailure(
      'save',
      [record.date],
      error,
      'No fue posible guardar el registro local.'
    );
  }
};

export const saveRecord = async (record: DailyRecord): Promise<void> => {
  await saveRecordStrict(record);
};

export const saveRecordsStrict = async (
  records: DailyRecord[]
): Promise<LocalRecordWriteResult> => {
  const dates = records.map(record => record.date);
  try {
    await ensureDbReady();
    if (records.length === 0) {
      return { ok: true, operation: 'save_many', store: resolveActiveWriteStore(), dates };
    }

    const store = resolveActiveWriteStore();
    if (isDatabaseInFallbackMode()) {
      records.forEach(record => {
        localPersistence.records.save(record);
        syncE2ERuntimeRecordMirror(record);
      });
      dispatchDailyRecordStoreChanged({
        operation: 'save',
        dates: records.map(record => record.date),
      });
      return { ok: true, operation: 'save_many', store, dates };
    }

    await db.dailyRecords.bulkPut(records);
    records.forEach(syncE2ERuntimeRecordMirror);
    dispatchDailyRecordStoreChanged({
      operation: 'save',
      dates: records.map(record => record.date),
    });
    return { ok: true, operation: 'save_many', store, dates };
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_save_records', error, {
      code: 'indexeddb_save_records_failed',
      message: 'No fue posible guardar registros locales en bloque.',
      severity: 'error',
      userSafeMessage: 'No fue posible guardar registros locales.',
      context: { count: records.length },
    });
    return buildLocalWriteFailure(
      'save_many',
      dates,
      error,
      'No fue posible guardar registros locales.'
    );
  }
};

export const saveRecords = async (records: DailyRecord[]): Promise<void> => {
  await saveRecordsStrict(records);
};

export const deleteRecordStrict = async (date: string): Promise<LocalRecordWriteResult> => {
  try {
    await ensureDbReady();
    const store = resolveActiveWriteStore();
    if (isDatabaseInFallbackMode()) {
      localPersistence.records.deleteForDate(date);
      dispatchDailyRecordStoreChanged({ operation: 'delete', dates: [date] });
      return { ok: true, operation: 'delete', store, dates: [date] };
    }
    await db.dailyRecords.delete(date);
    dispatchDailyRecordStoreChanged({ operation: 'delete', dates: [date] });
    return { ok: true, operation: 'delete', store, dates: [date] };
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_delete_record', error, {
      code: 'indexeddb_delete_record_failed',
      message: 'No fue posible eliminar el registro local.',
      severity: 'warning',
      userSafeMessage: 'No fue posible eliminar el registro local.',
      context: { date },
    });
    return buildLocalWriteFailure(
      'delete',
      [date],
      error,
      'No fue posible eliminar el registro local.'
    );
  }
};

export const deleteRecord = async (date: string): Promise<void> => {
  await deleteRecordStrict(date);
};

export const getAllDates = async (): Promise<string[]> => {
  try {
    await ensureDbReady();
    if (isDatabaseInFallbackMode()) {
      return localPersistence.records.getAllDates();
    }
    const records = await db.dailyRecords.orderBy('date').reverse().keys();
    return records as string[];
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_get_all_dates', error, {
      code: 'indexeddb_get_all_dates_failed',
      message: 'No fue posible obtener las fechas locales disponibles.',
      severity: 'warning',
      userSafeMessage: 'No fue posible recuperar las fechas locales disponibles.',
    });
    return [];
  }
};

export const getAllRecordsSorted = async (): Promise<DailyRecord[]> => {
  try {
    await ensureDbReady();
    if (isDatabaseInFallbackMode()) {
      return sortRecordsDescending(Object.values(await localPersistence.records.getAll()));
    }

    return await db.dailyRecords.orderBy('date').reverse().toArray();
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_get_sorted_records', error, {
      code: 'indexeddb_get_sorted_records_failed',
      message: 'No fue posible obtener registros locales ordenados.',
      severity: 'warning',
      userSafeMessage: 'No fue posible recuperar registros locales ordenados.',
    });
    return [];
  }
};

export const getPreviousDayRecord = async (currentDate: string): Promise<DailyRecord | null> => {
  try {
    await ensureDbReady();
    if (isDatabaseInFallbackMode()) {
      return localPersistence.records.getPreviousDayRecord(currentDate);
    }
    const record = await db.dailyRecords.where('date').below(currentDate).reverse().first();
    return record || null;
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_get_previous_day_record', error, {
      code: 'indexeddb_get_previous_day_record_failed',
      message: 'No fue posible obtener el registro del dia previo.',
      severity: 'warning',
      userSafeMessage: 'No fue posible recuperar el registro del dia previo.',
      context: { currentDate },
    });
    return null;
  }
};

export const clearAllRecords = async (): Promise<void> => {
  try {
    await ensureDbReady();
    if (isDatabaseInFallbackMode()) {
      localPersistence.records.clear();
      dispatchDailyRecordStoreChanged({ operation: 'clear' });
      return;
    }
    await db.dailyRecords.clear();
    dispatchDailyRecordStoreChanged({ operation: 'clear' });
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_clear_all_records', error, {
      code: 'indexeddb_clear_all_records_failed',
      message: 'No fue posible limpiar los registros locales.',
      severity: 'warning',
      userSafeMessage: 'No fue posible limpiar los registros locales.',
    });
  }
};
