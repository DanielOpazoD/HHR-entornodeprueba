import type { DailyRecord } from '@/types/domain/dailyRecord';
import { localPersistence } from '@/services/storage/localpersistence/localPersistenceService';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { isE2ERuntimeEnabled } from '@/shared/runtime/e2eRuntime';
import { arePatchValuesDeepEqual } from '@/utils/patchValueEquality';
import { listDailyRecordProjectionHolders } from '@/services/storage/sync/dexieSyncQueueQuarantine';
import {
  composeServerDayWithPending,
  type PendingPathsOverRemote,
} from '@/services/storage/sync/pendingDayComposition';
import { guardAuthoringSession } from '@/services/session/authoringSession';
import { ensureDbReady, hospitalDB as db, isDatabaseInFallbackMode } from './indexedDbCore';
import { dispatchDailyRecordStoreChanged } from './indexedDbRecordEvents';
import { publishAdmissionEffects } from './remoteAdmissionEffects';

export type LocalRecordBase = { kind: 'stored'; record: DailyRecord | null } | { kind: 'unknown' };

export type LocalRecordAdmission =
  | { status: 'admitted'; record: DailyRecord | null }
  | { status: 'retained_pending'; record: DailyRecord }
  | { status: 'superseded'; stored: DailyRecord | null };

export type LocalRecordAdmissionCandidate = {
  record: DailyRecord;
  expectedBase?: LocalRecordBase;
  remoteRecord?: DailyRecord | null;
  serverConfirmed?: boolean;
  isCurrent?: () => boolean;
  /** How a confirmed server day takes the paths of the writes still holding it (SAVE-04). */
  composeOverRemote?: PendingPathsOverRemote;
};

export type LocalRecordAdmissionResult = {
  date: string;
} & (
  | { status: 'admitted'; record: DailyRecord }
  /** `serverComposed`: the server's day with the pending paths on top; otherwise the stored copy. */
  | { status: 'retained_pending'; record: DailyRecord; serverComposed: boolean }
  | { status: 'superseded'; record: DailyRecord | null }
);

export const syncE2ERuntimeRecordMirror = (record: DailyRecord): void => {
  if (!isE2ERuntimeEnabled() || typeof window === 'undefined' || !window.__HHR_E2E_OVERRIDE__) {
    return;
  }

  localPersistence.records.save(record);
  window.__HHR_E2E_OVERRIDE__[record.date] = record;
};

export const admitsPointRead = (
  base: LocalRecordBase,
  stored: DailyRecord | null,
  candidate: DailyRecord | null
): boolean =>
  base.kind === 'unknown'
    ? stored === null
    : arePatchValuesDeepEqual(stored, base.record) ||
      (candidate !== null && arePatchValuesDeepEqual(stored, candidate));

export const inspectIndexedDbAdmission = async (
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

export const admitLocalRecords = async (
  candidates: readonly LocalRecordAdmissionCandidate[]
): Promise<LocalRecordAdmissionResult[]> => {
  const unique = [
    ...new Map(candidates.map(candidate => [candidate.record.date, candidate])).values(),
  ];
  if (!unique.length) return [];
  const session = guardAuthoringSession();
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
        for (const candidate of unique) {
          const { record, expectedBase, remoteRecord, isCurrent, serverConfirmed } = candidate;
          const stored = (await db.dailyRecords.get(record.date)) ?? null;
          if (!session.isCurrent() || (isCurrent && !isCurrent())) {
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
            const selected = remoteRecord ? record : (stored ?? record);
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
            // A confirmed server day shows under the writes still pending on it (SAVE-01).
            const composition =
              remoteRecord && serverConfirmed !== false && candidate.composeOverRemote
                ? await composeServerDayWithPending(
                    record.date,
                    record,
                    admission.record,
                    candidate.composeOverRemote
                  )
                : undefined;
            const composed =
              composition && 'record' in composition ? composition.record : undefined;
            if (composed && !arePatchValuesDeepEqual(admission.record, composed)) {
              writable.push(composed);
              changed.push(record.date);
            }
            decisions.push({
              date: record.date,
              status: admission.status,
              record: composed ?? admission.record,
              serverComposed: Boolean(composed),
            });
          } else {
            decisions.push({
              date: record.date,
              status: admission.status,
              record: admission.stored,
            });
          }
        }
        if (!session.isCurrent() || unique.some(item => item.isCurrent && !item.isCurrent())) {
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
    publishAdmissionEffects(occurrences);
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
