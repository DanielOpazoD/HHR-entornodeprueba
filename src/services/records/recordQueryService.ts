import type { PatientData } from '@/types/domain/patient';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import { admitRemoteDailyRecords } from '@/services/repositories/dailyRecordLocalCachePersistence';
import {
  getAllRecordsSorted,
  getRecordsForMonth,
  getRecordsRange,
} from '@/services/storage/indexeddb/indexedDbRecordService';

export const fetchRecordsForMonth = async (year: number, month: number): Promise<DailyRecord[]> => {
  return getRecordsForMonth(year, month);
};

const hasPatientData = (dayRecord: DailyRecord | undefined): boolean => {
  if (!dayRecord || !dayRecord.beds) return false;

  // Check if day has any patients
  return Object.values(dayRecord.beds).some(bed => {
    const patient = bed as PatientData;
    return Boolean(patient.patientName && patient.patientName.trim() !== '');
  });
};

export const fetchExistingDaysInMonth = async (year: number, month: number): Promise<number[]> => {
  const records = await getRecordsForMonth(year, month);

  return records.filter(hasPatientData).map(d => parseInt(d.date.split('-')[2]));
};

/** True when every given day is stored on this device and still has a patient. */
export const doStoredDaysHavePatientData = async (dates: string[]): Promise<boolean> => {
  if (dates.length === 0) return true;
  const ordered = [...dates].sort();
  const records = await getRecordsRange(ordered[0], ordered[ordered.length - 1]);
  const byDate = new Map(records.map(record => [record.date, record]));
  return dates.every(date => hasPatientData(byDate.get(date)));
};

export const fetchAllRecordsSorted = async (): Promise<DailyRecord[]> => {
  return getAllRecordsSorted();
};

export const fetchRecordsRangeSorted = async (
  startDate: string,
  endDate: string
): Promise<DailyRecord[]> => {
  const rangeRecords = await getRecordsRange(startDate, endDate);
  return rangeRecords.sort((a, b) => b.date.localeCompare(a.date));
};

export const syncRecordsRange = async (start: string, end: string): Promise<DailyRecord[]> => {
  // Local month/history reads must not initialize remote storage or write services.
  const { getRecordsRangeFromFirestore } =
    await import('@/services/storage/firestore/firestoreRecordQueries');
  const remoteRecords = await getRecordsRangeFromFirestore(start, end);
  if (remoteRecords.length === 0) return [];

  // A day with an edit this device has not sent yet keeps its local copy, and that copy is what
  // comes back. If the write fails nothing is stored and it is unknown which days were kept, so
  // the range is not answered with server copies that may be older than what the census shows.
  const results = await admitRemoteDailyRecords(
    remoteRecords.map(record => ({ record, remoteRecord: record }))
  );
  return results.flatMap(result => (result.record ? [result.record] : []));
};
