import { getStoredSessionOwnerKey } from '@/services/storage/sessionOwnerKey';
import { matchesOwner } from '@/services/storage/sync/dexieSyncQueueQuarantine';
import { projectRemoteAdmissionNotes } from '@/services/storage/indexeddb/remoteAdmissionNoteProjection';
import { publishSpecialistHandoffConflict } from '@/services/storage/medicalHandoffDraftStorage';
import type { SpecialistHandoffSyncPayload } from '@/services/storage/syncQueueTypes';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  saveRecordStrict as saveToIndexedDB,
  admitLocalRecords,
  type LocalRecordAdmissionCandidate,
  type LocalRecordAdmissionResult,
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

export type RemoteDailyRecordCandidate = LocalRecordAdmissionCandidate & {
  remoteRecord: DailyRecord | null;
  validateRecord?: boolean;
  selectRecord?: (stored: DailyRecord | null) => DailyRecord;
};

export type RemoteDailyRecordAdmission = LocalRecordAdmissionResult & {
  remoteRecord: DailyRecord | null;
};

/** Single or batch remote admission; remote evidence never acknowledges retained work. */
export const admitRemoteDailyRecords = async (
  candidates: readonly RemoteDailyRecordCandidate[]
): Promise<RemoteDailyRecordAdmission[]> => {
  const byDate = new Map(candidates.map(candidate => [candidate.record.date, candidate]));
  const detached: SpecialistHandoffSyncPayload[] = [];
  const owner = getStoredSessionOwnerKey();
  const results = await admitLocalRecords([...byDate.values()], (record, _stored, tasks) => {
    const selected = projectRemoteAdmissionNotes(
      byDate.get(record.date)?.selectRecord?.(_stored) ?? record,
      byDate.get(record.date)?.remoteRecord ?? null,
      tasks.filter(task => matchesOwner(owner, task.ownerKey)),
      detached
    );
    return selected.projected || byDate.get(record.date)?.validateRecord
      ? {
          ...selected,
          record: prepareDailyRecordForPersistence(selected.record, record.date, _stored),
        }
      : selected;
  });
  if (getStoredSessionOwnerKey() === owner) detached.forEach(publishSpecialistHandoffConflict);
  return results.map(result => ({
    ...result,
    remoteRecord: byDate.get(result.date)?.remoteRecord ?? null,
  }));
};
