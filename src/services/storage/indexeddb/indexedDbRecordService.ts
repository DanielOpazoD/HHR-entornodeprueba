import { DailyRecord } from '@/types/domain/dailyRecord';
import { localPersistence } from '@/services/storage/localpersistence/localPersistenceService';
import { buildMonthRecordPrefix } from '@/services/storage/storageDateSupport';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { isE2ERuntimeEnabled } from '@/shared/runtime/e2eRuntime';
import { arePatchValuesDeepEqual } from '@/utils/patchValueEquality';
import { listDailyRecordProjectionHolders } from '@/services/storage/sync/dexieSyncQueueQuarantine';
import { ensureDbReady, hospitalDB as db, isDatabaseInFallbackMode } from './indexedDbCore';
import { dispatchDailyRecordStoreChanged } from './indexedDbRecordEvents';
import { projectRemoteAdmissionNotes } from './remoteAdmissionNoteProjection';
import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import { getSessionEpoch } from '@/services/storage/sessionStorageTransition';
import type { SpecialistHandoffSyncPayload } from '@/services/storage/syncQueueTypes';
import { publishAdmissionEffects } from './remoteAdmissionEffects';

export type LocalRecordWriteStore = 'indexeddb' | 'fallback' | 'e2e' | 'none';
export type LocalRecordBase = { kind: 'stored'; record: DailyRecord | null } | { kind: 'unknown' };
export type LocalRecordAdmission =
  | { status: 'admitted'; record: DailyRecord | null }
  | { status: 'retained_pending'; record: DailyRecord }
  | { status: 'superseded'; stored: DailyRecord | null };
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

const syncE2ERuntimeRecordMirror = (record: DailyRecord): void => {
  if (!isE2ERuntimeEnabled() || typeof window === 'undefined' || !window.__HHR_E2E_OVERRIDE__) {
    return;
  }

  localPersistence.records.save(record);
  window.__HHR_E2E_OVERRIDE__[record.date] = record;
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
    return [];
  }
};

/** The local day, or null when there is none; a failed read throws instead of looking empty. */
export const getRecordForDateStrict = async (date: string): Promise<DailyRecord | null> => {
  await ensureDbReady();

  if (isDatabaseInFallbackMode()) {
    return localPersistence.records.getForDate(date);
  }

  const record = await db.dailyRecords.get(date);
  return record || null;
};

const reportRecordReadFailure = (date: string, error: unknown): void => {
  recordOperationalErrorTelemetry('indexeddb', 'indexeddb_get_record_for_date', error, {
    code: 'indexeddb_get_record_for_date_failed',
    message: `No fue posible obtener el registro del dia ${date}.`,
    severity: 'warning',
    userSafeMessage: 'No fue posible recuperar el registro solicitado.',
    context: { date },
  });
};

export const captureLocalRecordBase = async (date: string): Promise<LocalRecordBase> => {
  try {
    return { kind: 'stored', record: await getRecordForDateStrict(date) };
  } catch (error) {
    reportRecordReadFailure(date, error);
    return { kind: 'unknown' };
  }
};

export const getRecordForDate = async (date: string): Promise<DailyRecord | null> => {
  try {
    return await getRecordForDateStrict(date);
  } catch (error) {
    reportRecordReadFailure(date, error);
    return null;
  }
};

const admitsPointRead = (
  base: LocalRecordBase,
  stored: DailyRecord | null,
  candidate: DailyRecord | null
): boolean =>
  base.kind === 'unknown'
    ? stored === null
    : arePatchValuesDeepEqual(stored, base.record) ||
      (candidate !== null && arePatchValuesDeepEqual(stored, candidate));

const inspectIndexedDbAdmission = async (
  date: string,
  expectedBase?: LocalRecordBase,
  candidate: DailyRecord | null = null
): Promise<LocalRecordAdmission> => {
  const holders = await listDailyRecordProjectionHolders(date);
  const stored = (await db.dailyRecords.get(date)) ?? null;
  if (holders.length) {
    if (!stored) throw new Error('No existe la copia local de una escritura pendiente.');
    return { status: 'retained_pending', record: stored };
  }
  return expectedBase && !admitsPointRead(expectedBase, stored, candidate)
    ? { status: 'superseded', stored }
    : { status: 'admitted', record: stored };
};

export const inspectLocalRecordAdmission = async (
  date: string,
  expectedBase: LocalRecordBase,
  candidate: DailyRecord | null
): Promise<LocalRecordAdmission> => {
  await ensureDbReady();
  if (isDatabaseInFallbackMode()) {
    const stored = localPersistence.records.getForDate(date);
    return admitsPointRead(expectedBase, stored, candidate)
      ? { status: 'admitted', record: stored }
      : { status: 'superseded', stored };
  }
  // Read-write: a holder whose copy is already gone is released in this same transaction.
  return db.transaction('rw', db.dailyRecords, db.syncQueue, () =>
    inspectIndexedDbAdmission(date, expectedBase, candidate)
  );
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

export type LocalRecordAdmissionCandidate = {
  record: DailyRecord;
  expectedBase?: LocalRecordBase;
  remoteRecord?: DailyRecord | null;
  serverConfirmed?: boolean;
  isCurrent?: () => boolean;
};

export type LocalRecordAdmissionResult = {
  date: string;
} & (
  | { status: 'admitted' | 'retained_pending'; record: DailyRecord }
  | { status: 'superseded'; record: DailyRecord | null }
);
export const admitLocalRecords = async (
  candidates: readonly LocalRecordAdmissionCandidate[]
): Promise<LocalRecordAdmissionResult[]> => {
  const unique = [
    ...new Map(candidates.map(candidate => [candidate.record.date, candidate])).values(),
  ];
  if (!unique.length) return [];
  const owner = getStoredSessionOwnerKey();
  const epoch = getSessionEpoch();
  const detached: SpecialistHandoffSyncPayload[] = [];
  const changed: string[] = [];
  let occurrences = 0;
  try {
    await ensureDbReady();
    let results: LocalRecordAdmissionResult[];
    if (isDatabaseInFallbackMode()) {
      results = unique.map(({ record, expectedBase }) => {
        const stored = localPersistence.records.getForDate(record.date);
        if (expectedBase && !admitsPointRead(expectedBase, stored, record))
          return { date: record.date, status: 'superseded', record: stored };
        throw new Error('La admisión remota requiere IndexedDB y evidencia de cola.');
      });
    } else {
      results = await db.transaction('rw', [db.dailyRecords, db.syncQueue], async () => {
        const queuedKeys = new Set(
          await db.syncQueue
            .where('key')
            .anyOf(unique.map(({ record }) => `daily:${record.date}`))
            .uniqueKeys()
        );
        const decisions: LocalRecordAdmissionResult[] = [];
        const writable: DailyRecord[] = [];
        for (const { record, expectedBase, remoteRecord, isCurrent, serverConfirmed } of unique) {
          const stored = (await db.dailyRecords.get(record.date)) ?? null;
          if (
            owner !== getStoredSessionOwnerKey() ||
            epoch !== getSessionEpoch() ||
            (isCurrent && !isCurrent())
          ) {
            decisions.push({ date: record.date, status: 'superseded', record: stored });
            continue;
          }
          const admission: LocalRecordAdmission =
            queuedKeys.has(`daily:${record.date}`) || expectedBase
              ? await inspectIndexedDbAdmission(record.date, expectedBase, record)
              : { status: 'admitted', record: stored };
          if (admission.status === 'admitted') {
            if (serverConfirmed === false && stored) {
              decisions.push({ date: record.date, status: 'admitted', record: stored });
              continue;
            }
            const tasks = await db.syncQueue
              .where('key')
              .startsWith(`handoff:${record.date}:`)
              .toArray();
            const owned = tasks.filter(task => task.ownerKey === owner);
            const projected = projectRemoteAdmissionNotes(
              remoteRecord ? record : (stored ?? record),
              remoteRecord ?? null,
              owned,
              detached
            );
            const selected = projected.record;
            if (!arePatchValuesDeepEqual(stored, selected)) {
              if (
                stored &&
                remoteRecord &&
                Date.parse(stored.lastUpdated) > Date.parse(remoteRecord.lastUpdated)
              ) {
                occurrences += 1;
              }
              writable.push(selected);
              changed.push(record.date);
            }
            decisions.push({ date: record.date, status: 'admitted', record: selected });
          } else if (admission.status === 'retained_pending') {
            decisions.push({
              date: record.date,
              status: admission.status,
              record: admission.record,
            });
          } else {
            decisions.push({
              date: record.date,
              status: admission.status,
              record: admission.stored,
            });
          }
        }
        if (
          owner !== getStoredSessionOwnerKey() ||
          epoch !== getSessionEpoch() ||
          unique.some(item => item.isCurrent && !item.isCurrent())
        ) {
          throw new Error('La sesión o la observación cambió durante la admisión.');
        }
        if (writable.length) await db.dailyRecords.bulkPut(writable);
        return decisions;
      });
    }
    for (const result of results) {
      if (result.record) syncE2ERuntimeRecordMirror(result.record);
    }
    if (changed.length) dispatchDailyRecordStoreChanged({ operation: 'save', dates: changed });
    publishAdmissionEffects({ owner, epoch, detached, occurrences });
    return results;
  } catch (error) {
    recordOperationalErrorTelemetry('indexeddb', 'indexeddb_save_records', error, {
      code: 'indexeddb_save_records_failed',
      message: 'No fue posible guardar registros locales en bloque.',
      severity: 'error',
      userSafeMessage: 'No fue posible guardar registros locales.',
      context: { count: unique.length },
    });
    throw error;
  }
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

/** Every locally stored census date, newest first; a failed read throws instead of listing none. */
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

/** The closest earlier local day, or null when there is none; a failed read throws. */
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

export const clearAllRecords = async (options?: { throwOnError?: boolean }): Promise<void> => {
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
    if (options?.throwOnError) throw error;
  }
};
