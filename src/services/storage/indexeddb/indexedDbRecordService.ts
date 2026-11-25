import { DailyRecord } from '@/types/domain/dailyRecord';
import { localPersistence } from '@/services/storage/localpersistence/localPersistenceService';
import { buildMonthRecordPrefix } from '@/services/storage/storageDateSupport';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { listDailyRecordProjectionHolders } from '@/services/storage/sync/dexieSyncQueueQuarantine';
import { ensureDbReady, hospitalDB as db, isDatabaseInFallbackMode } from './indexedDbCore';
import { dispatchDailyRecordStoreChanged } from './indexedDbRecordEvents';
import {
  admitsPointRead,
  inspectIndexedDbAdmission,
  syncE2ERuntimeRecordMirror,
  type LocalRecordBase,
} from './indexedDbRecordAdmission';

export {
  admitLocalRecords,
  inspectLocalRecordAdmission,
  type LocalRecordAdmission,
  type LocalRecordAdmissionCandidate,
  type LocalRecordAdmissionResult,
  type LocalRecordBase,
} from './indexedDbRecordAdmission';

export type LocalRecordWriteStore = 'indexeddb' | 'fallback' | 'e2e' | 'none';
export interface LocalRecordWriteResult {
  ok: boolean;
  operation: 'save' | 'save_many' | 'delete';
  store: LocalRecordWriteStore;
  dates: string[];
  error?: unknown;
  userSafeMessage?: string;
  retainedRecord?: DailyRecord;
  records?: DailyRecord[];
  superseded?: { stored: DailyRecord | null };
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
    throw error;
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
    throw error;
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
    throw error;
  }
};

/** The local day, or null when there is none; a failed read throws instead of looking empty. */
export const getRecordForDateStrict = async (date: string): Promise<DailyRecord | null> => {
  try {
    await ensureDbReady();
    if (isDatabaseInFallbackMode()) return localPersistence.records.getForDate(date);
    return (await db.dailyRecords.get(date)) || null;
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_get_record_for_date', error, {
      code: 'indexeddb_get_record_for_date_failed',
      message: `No fue posible obtener el registro del dia ${date}.`,
      severity: 'warning',
      userSafeMessage: 'No fue posible recuperar el registro solicitado.',
      context: { date },
    });
    throw error;
  }
};

export const captureLocalRecordBase = async (date: string): Promise<LocalRecordBase> => {
  try {
    return { kind: 'stored', record: await getRecordForDateStrict(date) };
  } catch {
    return { kind: 'unknown' };
  }
};

export const saveRecordStrict = async (
  record: DailyRecord,
  options:
    | { preserveUnresolvedWrites?: false }
    | { preserveUnresolvedWrites: true; expectedBase?: LocalRecordBase } = {}
): Promise<LocalRecordWriteResult> => {
  try {
    await ensureDbReady();
    const store = resolveActiveWriteStore();
    const result = {
      ok: true,
      operation: 'save',
      store,
      dates: [record.date],
    } satisfies LocalRecordWriteResult;
    if (isDatabaseInFallbackMode()) {
      const stored = localPersistence.records.getForDate(record.date);
      if (
        options.preserveUnresolvedWrites &&
        options.expectedBase &&
        !admitsPointRead(options.expectedBase, stored, record)
      ) {
        return { ...result, superseded: { stored } };
      }
      localPersistence.records.save(record);
    } else if (options.preserveUnresolvedWrites) {
      const admission = await db.transaction('rw', db.dailyRecords, db.syncQueue, async () => {
        const admission = await inspectIndexedDbAdmission(
          record.date,
          options.expectedBase,
          record
        );
        if (admission.status === 'admitted') await db.dailyRecords.put(record);
        return admission;
      });
      if (admission.status === 'retained_pending')
        return { ...result, retainedRecord: admission.record };
      if (admission.status === 'superseded')
        return { ...result, superseded: { stored: admission.stored } };
    } else {
      await db.dailyRecords.put(record);
    }
    syncE2ERuntimeRecordMirror(record);
    dispatchDailyRecordStoreChanged({ operation: 'save', dates: [record.date] });
    return result;
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
      return { ok: true, operation: 'save_many', store: resolveActiveWriteStore(), dates, records };
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
      return { ok: true, operation: 'save_many', store, dates, records };
    }

    await db.dailyRecords.bulkPut(records);
    const admittedRecords = records;
    admittedRecords.forEach(syncE2ERuntimeRecordMirror);
    dispatchDailyRecordStoreChanged({
      operation: 'save',
      dates: records.map(record => record.date),
    });
    return { ok: true, operation: 'save_many', store, dates, records: admittedRecords };
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

/**
 * Deletes a stored day to refresh it, unless a day write still holds it, checked in the transaction
 * that deletes. Returns whether it was deleted; a storage failure throws, it is not "nothing held".
 */
export const deleteUnheldRecord = async (date: string): Promise<boolean> => {
  await ensureDbReady();
  if (isDatabaseInFallbackMode()) {
    localPersistence.records.deleteForDate(date);
  } else {
    const held = await db.transaction('rw', db.dailyRecords, db.syncQueue, async () => {
      if ((await listDailyRecordProjectionHolders(date)).length) return true;
      await db.dailyRecords.delete(date);
      return false;
    });
    if (held) return false;
  }
  dispatchDailyRecordStoreChanged({ operation: 'delete', dates: [date] });
  return true;
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
    throw error;
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
    throw error;
  }
};
