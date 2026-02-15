import { DailyRecord } from '@/types';
import {
  getRecordForDate as getRecordFromIndexedDB,
  getPreviousDayRecord as getPreviousDayFromIndexedDB,
  getAllDates as getAllDatesFromIndexedDB,
  getAllDemoRecords as getAllDemoRecordsFromIndexedDB,
  getDemoRecordForDate,
  getPreviousDemoDayRecord,
  saveRecord as saveToIndexedDB,
} from '@/services/storage/indexedDBService';
import {
  getAvailableDatesFromFirestore,
  getRecordFromFirestore,
} from '@/services/storage/firestoreService';
import { getLegacyRecord } from '@/services/storage/legacyFirebaseService';
import { isDemoModeActive, isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { migrateLegacyData } from '@/services/repositories/dataMigration';

export const getForDate = async (
  date: string,
  syncFromRemote: boolean = true
): Promise<DailyRecord | null> => {
  if (typeof window !== 'undefined' && window.__HHR_E2E_OVERRIDE__) {
    const override = window.__HHR_E2E_OVERRIDE__;
    if (override[date]) {
      console.warn(`[E2E] Using override record for ${date}`);
      return migrateLegacyData(override[date], date);
    }
  }

  if (isDemoModeActive()) {
    return await getDemoRecordForDate(date);
  }

  const localRecord = await getRecordFromIndexedDB(date);
  if (localRecord) {
    return migrateLegacyData(localRecord, date);
  }

  if (syncFromRemote && isFirestoreEnabled()) {
    try {
      console.warn(`[Repository DEBUG] Attempting Firestore fetch for ${date}`);
      const remoteRecord = await getRecordFromFirestore(date);
      if (remoteRecord) {
        const migrated = migrateLegacyData(remoteRecord, date);
        await saveToIndexedDB(migrated);
        return migrated;
      }

      console.log(`[Repository] 🔍 Checking legacy fallback for ${date}...`);
      const legacyRecord = await getLegacyRecord(date);
      if (legacyRecord) {
        console.log(`[Repository] 🎯 Found legacy record for ${date}. Migrating to Beta.`);
        const migrated = migrateLegacyData(legacyRecord, date);
        await saveToIndexedDB(migrated);
        return migrated;
      }
    } catch (err) {
      console.warn(`[Repository] getForDate: Remote fetch failed for ${date}:`, err);
    }
  }

  return localRecord ? migrateLegacyData(localRecord, date) : null;
};

export const getAvailableDates = async (): Promise<string[]> => {
  if (isDemoModeActive()) {
    const records = await getAllDemoRecordsFromIndexedDB();
    return Object.keys(records).sort().reverse();
  }

  const localDates = await getAllDatesFromIndexedDB();

  if (isFirestoreEnabled()) {
    try {
      const remoteDates = await getAvailableDatesFromFirestore();
      const allDates = Array.from(new Set([...localDates, ...remoteDates]));
      return allDates.sort().reverse();
    } catch (err) {
      console.warn('[Repository] Failed to fetch remote dates:', err);
    }
  }

  return localDates.sort().reverse();
};

export const getPreviousDay = async (date: string): Promise<DailyRecord | null> => {
  if (isDemoModeActive()) {
    return await getPreviousDemoDayRecord(date);
  }

  const localRecord = await getPreviousDayFromIndexedDB(date);
  if (localRecord) {
    return migrateLegacyData(localRecord, localRecord.date);
  }

  if (isFirestoreEnabled()) {
    try {
      const allDates = await getAvailableDates();
      const prevDate = allDates.find(d => d < date);

      if (prevDate) {
        return await getForDate(prevDate);
      }
    } catch (err) {
      console.warn('[Repository] getPreviousDay remote check failed:', err);
    }
  }

  return null;
};
