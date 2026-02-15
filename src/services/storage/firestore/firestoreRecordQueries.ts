import { doc, getDoc, getDocs, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { DailyRecord } from '@/types';
import { COLLECTIONS, getActiveHospitalId } from '@/constants/firestorePaths';
import {
  docToRecord,
  getRecordDocRef,
  getRecordsCollection,
} from '@/services/storage/firestore/firestoreShared';

export const getAvailableDatesFromFirestore = async (): Promise<string[]> => {
  try {
    const q = query(getRecordsCollection());
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs
      .map(docItem => docItem.id)
      .sort()
      .reverse();
  } catch (error) {
    console.error('[Firestore] Error fetching available dates:', error);
    return [];
  }
};

export const getRecordFromFirestore = async (date: string): Promise<DailyRecord | null> => {
  try {
    const docRef = getRecordDocRef(date);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      return docToRecord(docSnap.data(), date);
    }
    return null;
  } catch (error) {
    console.error('❌ Error getting record from Firestore:', error);
    return null;
  }
};

export const getAllRecordsFromFirestore = async (): Promise<Record<string, DailyRecord>> => {
  try {
    const q = query(getRecordsCollection(), orderBy('date', 'desc'));
    const querySnapshot = await getDocs(q);

    const records: Record<string, DailyRecord> = {};
    querySnapshot.forEach(docItem => {
      records[docItem.id] = docToRecord(docItem.data(), docItem.id);
    });

    return records;
  } catch (error) {
    console.error('❌ Error getting all records from Firestore:', error);
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
    return querySnapshot.docs.map(docItem => docToRecord(docItem.data(), docItem.id));
  } catch (error) {
    console.error(`❌ Error getting records for range ${startDate} to ${endDate}:`, error);
    return [];
  }
};

export const getMonthRecordsFromFirestore = async (
  year: number,
  month: number
): Promise<DailyRecord[]> => {
  try {
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-31`;

    return getRecordsRangeFromFirestore(startDate, endDate);
  } catch (error) {
    console.error('❌ Error getting month records:', error);
    return [];
  }
};

export const subscribeToRecord = (
  date: string,
  callback: (record: DailyRecord | null, hasPendingWrites: boolean) => void
): (() => void) => {
  const docRef = getRecordDocRef(date);

  return onSnapshot(
    docRef,
    { includeMetadataChanges: true },
    docSnap => {
      const hasPendingWrites = docSnap.metadata.hasPendingWrites;
      if (docSnap.exists()) {
        callback(docToRecord(docSnap.data(), date), hasPendingWrites);
      } else {
        callback(null, hasPendingWrites);
      }
    },
    error => {
      console.error('❌ Firestore subscription error:', error);
      callback(null, false);
    }
  );
};

export const isFirestoreAvailable = async (): Promise<boolean> => {
  try {
    const docRef = doc(db, COLLECTIONS.HOSPITALS, getActiveHospitalId());
    await getDoc(docRef);
    return true;
  } catch (_error) {
    return false;
  }
};
