import { doc, getDoc, getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import { COLLECTIONS, getActiveHospitalId } from '@/constants/firestorePaths';
import {
  docToRecord,
  getRecordDocRef,
  getRecordsCollection,
} from '@/services/storage/firestore/firestoreShared';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import {
  buildFirestoreMonthDateRange,
  mapFirestoreRecords,
  toFirestoreRecordMap,
} from '@/services/storage/firestore/firestoreQuerySupport';
import { firestoreQueryLogger } from '@/services/storage/storageLoggers';

const logFirestoreQueryError = (
  operation: string,
  error: unknown,
  context?: Record<string, unknown>
): void => {
  firestoreQueryLogger.error(`Firestore query failed: ${operation}`, {
    error,
    ...(context || {}),
  });
};

export interface FirestoreSingleRecordReadResult {
  status: 'resolved' | 'missing' | 'failed';
  record: DailyRecord | null;
  error?: unknown;
}

export interface FirestoreRecordSnapshotMetadata {
  hasPendingWrites: boolean;
  fromCache: boolean;
}

export const getRecordFromFirestoreDetailed = async (
  date: string
): Promise<FirestoreSingleRecordReadResult> => {
  try {
    const docRef = getRecordDocRef(date);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return {
        status: 'resolved',
        record: docToRecord(docSnap.data(), date),
      };
    }

    return {
      status: 'missing',
      record: null,
    };
  } catch (error) {
    logFirestoreQueryError('getRecord', error, { date });
    return {
      status: 'failed',
      record: null,
      error,
    };
  }
};

export const getAvailableDatesFromFirestore = async (): Promise<string[]> => {
  try {
    const q = query(getRecordsCollection());
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs
      .map(docItem => docItem.id)
      .sort()
      .reverse();
  } catch (error) {
    logFirestoreQueryError('getAvailableDates', error);
    return [];
  }
};

export const getRecordFromFirestore = async (date: string): Promise<DailyRecord | null> => {
  const result = await getRecordFromFirestoreDetailed(date);
  return result.record;
};

export const getAllRecordsFromFirestore = async (): Promise<Record<string, DailyRecord>> => {
  try {
    const q = query(getRecordsCollection(), orderBy('date', 'desc'));
    const querySnapshot = await getDocs(q);
    return toFirestoreRecordMap(mapFirestoreRecords(querySnapshot, docToRecord));
  } catch (error) {
    logFirestoreQueryError('getAllRecords', error);
    return {};
  }
};

export const getRecordsRangeFromFirestore = async (
  startDate: string,
  endDate: string
): Promise<DailyRecord[]> => {
  try {
    const q = query(
      getRecordsCollection(),
      where('date', '>=', startDate),
      where('date', '<=', endDate),
      orderBy('date', 'asc')
    );

    const querySnapshot = await getDocs(q);
    return mapFirestoreRecords(querySnapshot.docs, docToRecord);
  } catch (error) {
    logFirestoreQueryError('getRecordsRange', error, { startDate, endDate });
    return [];
  }
};

export const getMonthRecordsFromFirestore = async (
  year: number,
  month: number
): Promise<DailyRecord[]> => {
  try {
    const { startDate, endDate } = buildFirestoreMonthDateRange(year, month);
    return getRecordsRangeFromFirestore(startDate, endDate);
  } catch (error) {
    logFirestoreQueryError('getMonthRecords', error, { year, month: month + 1 });
    return [];
  }
};

export const subscribeToRecord = (
  date: string,
  callback: (
    record: DailyRecord | null,
    hasPendingWrites: boolean,
    metadata?: FirestoreRecordSnapshotMetadata
  ) => void
): (() => void) => {
  const docRef = getRecordDocRef(date);

  return onSnapshot(
    docRef,
    { includeMetadataChanges: true },
    docSnap => {
      const metadata = {
        hasPendingWrites: docSnap.metadata.hasPendingWrites,
        fromCache: docSnap.metadata.fromCache,
      };
      if (docSnap.exists()) {
        callback(docToRecord(docSnap.data(), date), metadata.hasPendingWrites, metadata);
      } else {
        callback(null, metadata.hasPendingWrites, metadata);
      }
    },
    error => {
      logFirestoreQueryError('subscribeToRecord', error, { date });
    }
  );
};

export const isFirestoreAvailable = async (): Promise<boolean> => {
  try {
    const docRef = doc(
      defaultFirestoreServiceRuntime.getDb(),
      COLLECTIONS.HOSPITALS,
      getActiveHospitalId()
    );
    await getDoc(docRef);
    return true;
  } catch (_error) {
    return false;
  }
};
