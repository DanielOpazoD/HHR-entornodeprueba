import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';

import { parseDailyRecordWithDefaults } from '@/schemas/zodSchemas';
import { DailyRecord } from '@/types';

import { getLegacyDb } from './legacyFirebaseCore';
import {
  LEGACY_DISCOVERY_COLLECTION_PATHS,
  LEGACY_RECORD_COLLECTION_PATHS,
  LEGACY_RECORD_DOC_PATHS,
} from './legacyFirebasePaths';

export const getLegacyRecord = async (date: string): Promise<DailyRecord | null> => {
  const db = getLegacyDb();
  if (!db) {
    console.warn('[LegacyFirebase] No connection available');
    return null;
  }

  try {
    const possiblePaths = LEGACY_RECORD_DOC_PATHS(date);
    for (const path of possiblePaths) {
      try {
        console.log(`[LegacyFirebase] 🧪 Testing path: ${path}`);
        const docRef = doc(db, path);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          console.log(`[LegacyFirebase] 🎯 Found record at: ${path}`);
          return parseDailyRecordWithDefaults(docSnap.data(), date);
        }
      } catch (error) {
        console.warn(`[LegacyFirebase] ❌ Error testing path ${path}:`, error);
      }
    }

    console.log(`[LegacyFirebase] No legacy record found for ${date}`);
    return null;
  } catch (error) {
    console.error('[LegacyFirebase] Error reading legacy record:', error);
    return null;
  }
};

export const getLegacyRecordsRange = async (
  startDate: string,
  endDate: string
): Promise<DailyRecord[]> => {
  const db = getLegacyDb();
  if (!db) return [];

  try {
    for (const collectionPath of LEGACY_RECORD_COLLECTION_PATHS) {
      try {
        const colRef = collection(db, collectionPath);
        const rangeQuery = query(
          colRef,
          where('date', '>=', startDate),
          where('date', '<=', endDate),
          orderBy('date', 'asc')
        );

        const snapshot = await getDocs(rangeQuery);
        if (!snapshot.empty) {
          console.log(`[LegacyFirebase] 📚 Found ${snapshot.size} records in ${collectionPath}`);
          return snapshot.docs.map(d => parseDailyRecordWithDefaults(d.data(), d.id));
        }
      } catch {
        // Ignore invalid/non-existing path and continue with next option.
      }
    }
    return [];
  } catch (error) {
    console.error('[LegacyFirebase] Error reading legacy range:', error);
    return [];
  }
};

export const subscribeLegacyRecord = (
  date: string,
  callback: (record: DailyRecord | null) => void
): (() => void) => {
  const db = getLegacyDb();
  if (!db) {
    callback(null);
    return () => {};
  }

  const docRef = doc(db, 'hospitals/hanga_roa/dailyRecords', date);

  return onSnapshot(
    docRef,
    docSnap => {
      if (docSnap.exists()) {
        callback(parseDailyRecordWithDefaults(docSnap.data(), date));
      } else {
        callback(null);
      }
    },
    error => {
      console.error('[LegacyFirebase] Subscription error:', error);
      callback(null);
    }
  );
};

export const discoverLegacyDataPath = async (): Promise<string | null> => {
  const db = getLegacyDb();
  if (!db) return null;

  for (const path of LEGACY_DISCOVERY_COLLECTION_PATHS) {
    try {
      const colRef = collection(db, path);
      const q = query(colRef, orderBy('date', 'desc'));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        console.log(`[LegacyFirebase] 🎯 Discovered data path: ${path} (${snapshot.size} records)`);
        return path;
      }
    } catch {
      // Path not found or unsupported query index.
    }
  }

  console.warn('[LegacyFirebase] Could not discover any valid data path');
  return null;
};
