import { DailyRecord } from '@/types';
import {
  getDemoRecordForDate,
  saveRecord as saveToIndexedDB,
} from '@/services/storage/indexedDBService';
import { getRecordFromFirestore, subscribeToRecord } from '@/services/storage/firestoreService';
import { getLegacyRecord } from '@/services/storage/legacyFirebaseService';
import { isDemoModeActive, isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { migrateLegacyData } from '@/services/repositories/dataMigration';

export const subscribe = (
  date: string,
  callback: (r: DailyRecord | null, hasPendingWrites: boolean) => void
): (() => void) => {
  if (isDemoModeActive()) {
    getDemoRecordForDate(date).then(r => callback(r, false));
    return () => {};
  }

  return subscribeToRecord(date, async (record, hasPendingWrites) => {
    const migrated = record ? migrateLegacyData(record, date) : null;
    if (migrated && !hasPendingWrites) {
      await saveToIndexedDB(migrated);
    }
    callback(migrated, hasPendingWrites);
  });
};

export const syncWithFirestore = async (date: string): Promise<DailyRecord | null> => {
  if (isDemoModeActive() || !isFirestoreEnabled()) return null;

  try {
    const record = await getRecordFromFirestore(date);
    if (record) {
      const migrated = migrateLegacyData(record, date);
      await saveToIndexedDB(migrated);
      return migrated;
    }

    const legacyRecord = await getLegacyRecord(date);
    if (legacyRecord) {
      const migrated = migrateLegacyData(legacyRecord, date);
      await saveToIndexedDB(migrated);
      return migrated;
    }
  } catch (err) {
    console.warn(`[Repository] Sync failed for ${date}:`, err);
  }
  return null;
};
