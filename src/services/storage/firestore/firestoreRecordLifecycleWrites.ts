import { deleteDoc, setDoc, Timestamp } from 'firebase/firestore';
import type { DailyRecord } from '@/services/storage/storageDailyRecordContracts';
import { withRetry } from '@/utils/networkUtils';
import {
  getRecordDocRef,
  sanitizeForFirestore,
} from '@/services/storage/firestore/firestoreShared';
import { createDeletedRecordRef } from '@/services/storage/firestore/firestoreWriteSupport';
import { withStoredIdentity } from '@/shared/census/patientIdentityReview';
import {
  logFirestoreWriteError,
  logFirestoreWriteRetry,
} from '@/services/storage/firestore/firestoreRecordWriteUtilities';

export const deleteRecordFromFirestore = async (date: string): Promise<void> => {
  try {
    const docRef = getRecordDocRef(date);
    await withRetry(() => deleteDoc(docRef), {
      onRetry: (err: unknown, attempt: number) =>
        logFirestoreWriteRetry('delete', date, attempt, err),
    });
  } catch (error) {
    logFirestoreWriteError('delete', date, error);
    throw error;
  }
};

export const moveRecordToTrash = async (record: DailyRecord): Promise<void> => {
  const storedRecord = withStoredIdentity(record);
  try {
    const trashRef = createDeletedRecordRef(record.date);
    await withRetry(() =>
      setDoc(trashRef, {
        ...(sanitizeForFirestore(storedRecord) as Record<string, unknown>),
        deletedAt: Timestamp.now(),
        originalDate: record.date,
      })
    );
  } catch (error) {
    logFirestoreWriteError('moveToTrash', record.date, error);
    throw error;
  }
};
