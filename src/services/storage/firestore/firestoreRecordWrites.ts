import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  Timestamp,
  updateDoc,
  type DocumentData,
  type DocumentReference,
  type UpdateData,
} from 'firebase/firestore';
import { db } from '@/firebaseConfig';
import { DailyRecord, DailyRecordPatch } from '@/types';
import { withRetry } from '@/utils/networkUtils';
import { COLLECTIONS, getActiveHospitalId, HOSPITAL_COLLECTIONS } from '@/constants/firestorePaths';
import {
  flattenObject,
  getRecordDocRef,
  getRecordsCollection,
  sanitizeForFirestore,
} from '@/services/storage/firestore/firestoreShared';

const saveHistorySnapshot = async (date: string): Promise<void> => {
  try {
    const docRef = getRecordDocRef(date);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      const historyRef = doc(collection(docRef, 'history'), new Date().toISOString());

      await setDoc(historyRef, {
        ...data,
        snapshotTimestamp: Timestamp.now(),
      });
    }
  } catch (error) {
    console.error('❌ Failed to create history snapshot:', error);
  }
};

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

export const saveRecordToFirestore = async (
  record: DailyRecord,
  expectedLastUpdated?: string
): Promise<void> => {
  try {
    const docRef = getRecordDocRef(record.date);

    if (expectedLastUpdated) {
      try {
        const remoteDoc = await getDoc(docRef);
        if (remoteDoc.exists()) {
          const remoteData = remoteDoc.data();
          const remoteLastUpdated =
            remoteData.lastUpdated instanceof Timestamp
              ? remoteData.lastUpdated.toDate().toISOString()
              : (remoteData.lastUpdated as string);

          if (remoteLastUpdated && new Date(remoteLastUpdated) > new Date(expectedLastUpdated)) {
            console.warn(
              `[Firestore] Concurrency conflict. Remote: ${remoteLastUpdated}, Local base: ${expectedLastUpdated}`
            );
            throw new ConcurrencyError(
              'El registro ha sido modificado por otro usuario. Por favor recarga la página.'
            );
          }
        }
      } catch (err) {
        if (err instanceof ConcurrencyError) throw err;
        console.warn(
          '[Firestore] Could not verify concurrency (likely offline), proceeding with save.'
        );
      }
    }

    await saveHistorySnapshot(record.date);

    const sanitizedRecord = sanitizeForFirestore({
      ...record,
      lastUpdated: Timestamp.now(),
    });

    await withRetry(() => setDoc(docRef, sanitizedRecord as Record<string, unknown>), {
      onRetry: (err: unknown, attempt: number) =>
        console.warn(`[Firestore] Retry ${attempt} saving record ${record.date}:`, err),
    });
  } catch (error) {
    console.error('❌ Error saving to Firestore:', error);
    throw error;
  }
};

export const updateRecordPartial = async (
  date: string,
  partialData: DailyRecordPatch
): Promise<void> => {
  try {
    const docRef = getRecordDocRef(date);

    await saveHistorySnapshot(date);

    const flatData = flattenObject(partialData as unknown as Record<string, unknown>);
    const sanitizedData = sanitizeForFirestore({
      ...flatData,
      lastUpdated: Timestamp.now(),
    }) as Record<string, unknown>;

    try {
      const updatePayload = sanitizedData as UpdateData<DocumentData>;
      const recordDocRef = docRef as DocumentReference<DocumentData>;
      await withRetry(() => updateDoc(recordDocRef, updatePayload), {
        onRetry: (err: unknown, attempt: number) =>
          console.warn(`[Firestore] Retry ${attempt} updating record ${date}:`, err),
      });
    } catch (error: unknown) {
      const storageError = error as { code?: string };
      if (storageError?.code === 'not-found') {
        console.warn(
          `[Firestore] Document ${date} not found for partial update. Creating with setDoc.`
        );
        await withRetry(() => setDoc(docRef, sanitizedData, { merge: true }));
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error('❌ Error in partial update to Firestore:', error);
    throw error;
  }
};

export const deleteRecordFromFirestore = async (date: string): Promise<void> => {
  try {
    const docRef = getRecordDocRef(date);
    await withRetry(() => deleteDoc(docRef), {
      onRetry: (err: unknown, attempt: number) =>
        console.warn(`[Firestore] Retry ${attempt} deleting record ${date}:`, err),
    });
  } catch (error) {
    console.error('❌ Error deleting from Firestore:', error);
    throw error;
  }
};

export const moveRecordToTrash = async (record: DailyRecord): Promise<void> => {
  try {
    const trashRef = doc(
      db,
      COLLECTIONS.HOSPITALS,
      getActiveHospitalId(),
      HOSPITAL_COLLECTIONS.DELETED_RECORDS,
      `${record.date}_trash_${new Date().getTime()}`
    );

    await withRetry(() =>
      setDoc(trashRef, {
        ...(sanitizeForFirestore(record) as Record<string, unknown>),
        deletedAt: Timestamp.now(),
        originalDate: record.date,
      })
    );
  } catch (error) {
    console.error('❌ Error moving record to trash:', error);
    throw error;
  }
};
