import { collection, doc, type DocumentReference, Timestamp } from 'firebase/firestore';
import { DailyRecord } from '@/types/domain/dailyRecord';
import { COLLECTIONS, getActiveHospitalId, HOSPITAL_COLLECTIONS } from '@/constants/firestorePaths';
import { migrateLegacyData } from '@/services/repositories/dataMigration';
import { normalizeUnknownDailyRecordStaffing } from '@/services/staff/dailyRecordStaffing';
import { defaultFirestoreServiceRuntime } from '@/services/storage/firestore/firestoreServiceRuntime';
import type { FirestoreServiceRuntimePort } from '@/services/storage/firestore/ports/firestoreServiceRuntimePort';

export const getRecordsCollection = (
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
) =>
  collection(
    runtime.getDb(),
    COLLECTIONS.HOSPITALS,
    getActiveHospitalId(),
    HOSPITAL_COLLECTIONS.DAILY_RECORDS
  );

export const getRecordDocRef = (
  date: string,
  runtime: FirestoreServiceRuntimePort = defaultFirestoreServiceRuntime
): DocumentReference => doc(getRecordsCollection(runtime), date);

export const sanitizeForFirestore = (obj: unknown): unknown => {
  if (obj === undefined) {
    return null;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeForFirestore);
  }
  if (
    obj !== null &&
    typeof obj === 'object' &&
    !(obj instanceof Date) &&
    !(obj instanceof Timestamp)
  ) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = sanitizeForFirestore(v);
    }
    return result;
  }
  return obj;
};

export const ensureArray = (value: unknown, defaultLength: number): string[] => {
  if (Array.isArray(value)) {
    const result = [...value];
    while (result.length < defaultLength) {
      result.push('');
    }
    return result.slice(0, defaultLength);
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, string>;
    const result: string[] = [];
    for (let i = 0; i < defaultLength; i++) {
      result.push(obj[String(i)] || '');
    }
    return result;
  }

  return Array(defaultLength).fill('');
};

export const flattenObject = (
  obj: Record<string, unknown>,
  prefix = ''
): Record<string, unknown> => {
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return prefix ? { [prefix]: {} } : {};
  }

  return keys.reduce((acc: Record<string, unknown>, k) => {
    const pre = prefix.length ? `${prefix}.` : '';
    const val = obj[k];
    if (
      typeof val === 'object' &&
      val !== null &&
      !Array.isArray(val) &&
      !(val instanceof Date) &&
      !(val instanceof Timestamp)
    ) {
      Object.assign(acc, flattenObject(val as Record<string, unknown>, pre + k));
    } else {
      acc[pre + k] = val;
    }
    return acc;
  }, {});
};

export const docToRecord = (docData: Record<string, unknown>, docId: string): DailyRecord => {
  const rawData = { ...docData };

  if (rawData.lastUpdated instanceof Timestamp) {
    rawData.lastUpdated = rawData.lastUpdated.toDate().toISOString();
  }

  const normalizedStaffing = normalizeUnknownDailyRecordStaffing(rawData, value =>
    ensureArray(value, 2)
  );
  const nurses = normalizedStaffing['nurses'];
  const nursesDayShift = normalizedStaffing['nursesDayShift'];
  const nursesNightShift = normalizedStaffing['nursesNightShift'];

  Object.assign(rawData, {
    nurses,
    nursesDayShift,
    nursesNightShift,
    tensDayShift: ensureArray(rawData.tensDayShift, 3),
    tensNightShift: ensureArray(rawData.tensNightShift, 3),
    activeExtraBeds: Array.isArray(rawData.activeExtraBeds) ? rawData.activeExtraBeds : [],
  });

  return migrateLegacyData(rawData as unknown as DailyRecord, docId);
};

export const readStringCatalogFromSnapshot = (
  docSnap: { exists: () => boolean; data: () => Record<string, unknown> | undefined },
  legacyField: 'nurses' | 'tens'
): string[] => {
  if (!docSnap.exists()) return [];

  const data = docSnap.data() || {};
  const primary = data.list;
  if (Array.isArray(primary)) return primary as string[];

  const legacy = data[legacyField];
  if (Array.isArray(legacy)) return legacy as string[];

  return [];
};
