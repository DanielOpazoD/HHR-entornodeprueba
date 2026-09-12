import { recordCensusServerSnapshot } from '@/shared/runtime/censusStartupPerf';
import {
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  documentId,
  limit as limitTo,
  onSnapshot,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
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
import { classifySyncError } from '@/services/storage/syncErrorCatalog';
import { reportBasicReadPermissionDenied } from '@/services/auth/sessionPermissionStormDetector';

const logFirestoreQueryError = (
  operation: string,
  error: unknown,
  context?: Record<string, unknown>
): void => {
  firestoreQueryLogger.error(`Firestore query failed: ${operation}`, {
    error,
    ...(context || {}),
  });
  // Las lecturas del censo las permite TODO rol autorizado: una denegación aquí
  // es señal de sesión sin permisos, no de un permiso faltante por rol.
  if (classifySyncError(error).category === 'authorization')
    reportBasicReadPermissionDenied(`records:${operation}`);
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

interface FirestoreSingleRecordReadOptions {
  /** Bypasses local Firestore cache when an accepted write needs an authoritative readback. */
  source?: 'default' | 'server';
}

export const getRecordFromFirestoreDetailed = async (
  date: string,
  options: FirestoreSingleRecordReadOptions = {}
): Promise<FirestoreSingleRecordReadResult> => {
  try {
    const docRef = getRecordDocRef(date);
    const docSnap =
      options.source === 'server' ? await getDocFromServer(docRef) : await getDoc(docRef);

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

/**
 * Reads every census document in history to keep only the document ids. The Web SDK
 * has no field projection, so this is expensive and grows by one document per day.
 * Reserved for migrations and backfills that genuinely need the whole range.
 */
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

/**
 * Census document ids are ISO dates, so a bounded id range reads only a recent window
 * instead of the whole history. Descending id order needs a composite index that this
 * project does not define, so the window is read ascending and reversed in memory.
 */
export const RECENT_CENSUS_WINDOW_DAYS = 30;

export const shiftIsoDate = (date: string, deltaDays: number): string => {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
  return parsed.toISOString().slice(0, 10);
};

const readCensusDateWindow = async (fromDate: string, beforeDate?: string): Promise<string[]> => {
  const constraints = [where(documentId(), '>=', fromDate)];
  if (beforeDate) {
    constraints.push(where(documentId(), '<', beforeDate));
  }
  const q = query(
    getRecordsCollection(),
    ...constraints,
    orderBy(documentId()),
    limitTo(RECENT_CENSUS_WINDOW_DAYS + 5)
  );
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(docItem => docItem.id).sort();
};

/** Recent census dates only. Cost stays constant as the hospital accumulates days. */
export const getRecentAvailableDatesFromFirestore = async (
  referenceDate: string
): Promise<string[]> => {
  try {
    const from = shiftIsoDate(referenceDate, -RECENT_CENSUS_WINDOW_DAYS);
    return (await readCensusDateWindow(from)).reverse();
  } catch (error) {
    logFirestoreQueryError('getRecentAvailableDates', error);
    return [];
  }
};

/**
 * Closest earlier census date. Reads a bounded window; only a gap longer than the
 * window falls back to the expensive full scan, so correctness is preserved.
 */
export const getPreviousRecordDateFromFirestore = async (date: string): Promise<string | null> => {
  try {
    const from = shiftIsoDate(date, -RECENT_CENSUS_WINDOW_DAYS);
    const windowDates = await readCensusDateWindow(from, date);
    if (windowDates.length > 0) {
      return windowDates[windowDates.length - 1];
    }
  } catch (error) {
    logFirestoreQueryError('getPreviousRecordDate', error);
  }

  const allDates = await getAvailableDatesFromFirestore();
  return allDates.find(candidate => candidate < date) ?? null;
};

export const getRecordFromFirestore = async (
  date: string,
  options: FirestoreSingleRecordReadOptions = {}
): Promise<DailyRecord | null> => {
  const result = await getRecordFromFirestoreDetailed(date, options);
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
  endDate: string,
  options: { requireServer?: boolean } = {}
): Promise<DailyRecord[]> => {
  try {
    const q = query(
      getRecordsCollection(),
      where('date', '>=', startDate),
      where('date', '<=', endDate),
      orderBy('date', 'asc')
    );

    const querySnapshot = await (options.requireServer ? getDocsFromServer(q) : getDocs(q));
    return mapFirestoreRecords(querySnapshot.docs, docToRecord);
  } catch (error) {
    logFirestoreQueryError('getRecordsRange', error, { startDate, endDate });
    // A history reader must distinguish a real empty result from unavailable remote data.
    if (options.requireServer) throw error;
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
      recordCensusServerSnapshot(
        date,
        metadata.fromCache,
        metadata.hasPendingWrites,
        docSnap.exists()
      );
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
