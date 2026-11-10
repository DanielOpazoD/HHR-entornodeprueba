import type { DailyRecord } from '@/services/contracts/dailyRecordServiceContracts';
import {
  getRecordsRange,
  saveRecordsStrict,
} from '@/services/storage/indexeddb/indexedDbRecordService';
import * as firestoreService from '@/services/storage/firestore';
import { getTodayISO } from '@/utils/dateCoreUtils';
import { isFirestoreEnabled } from '@/services/repositories/repositoryConfig';
import { resolvePreferredDailyRecord } from '@/services/repositories/dailyRecordSyncCompatibility';

export const DATA_MAINTENANCE_MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

const sortRecordsAscending = (records: DailyRecord[]): DailyRecord[] =>
  [...records].sort((left, right) => left.date.localeCompare(right.date));

const mergeRecordsByDate = (
  localRecords: DailyRecord[],
  remoteRecords: DailyRecord[]
): DailyRecord[] => {
  const dates = new Set([
    ...localRecords.map(record => record.date),
    ...remoteRecords.map(record => record.date),
  ]);
  const localMap = new Map(localRecords.map(record => [record.date, record]));
  const remoteMap = new Map(remoteRecords.map(record => [record.date, record]));

  return sortRecordsAscending(
    Array.from(dates)
      .map(date =>
        resolvePreferredDailyRecord(localMap.get(date) ?? null, remoteMap.get(date) ?? null)
      )
      .filter((record): record is DailyRecord => record !== null)
  );
};

export const hydrateRangeRecords = async (
  startDate: string,
  endDate: string
): Promise<DailyRecord[]> => {
  const localRecords = await getRecordsRange(startDate, endDate);

  if (!isFirestoreEnabled()) {
    return sortRecordsAscending(localRecords);
  }

  const remoteRecords = await firestoreService.getRecordsRangeFromFirestore(startDate, endDate);
  const mergedRecords = mergeRecordsByDate(localRecords, remoteRecords);

  if (mergedRecords.length > 0) {
    const result = await saveRecordsStrict(mergedRecords, { preserveUnresolvedWrites: true });
    if (!result.ok) {
      throw new Error(result.userSafeMessage ?? 'No fue posible guardar registros locales.');
    }
    return result.records ?? mergedRecords;
  }

  return mergedRecords;
};

export const resolveMonthDateRange = (
  year: number,
  month: number
): { startDate: string; endDate: string } => ({
  startDate: `${year}-${String(month).padStart(2, '0')}-01`,
  endDate: `${year}-${String(month).padStart(2, '0')}-31`,
});

export const resolveYearToDateRange = (
  year: number,
  now: Date = new Date()
): { startDate: string; endDate: string; isCurrentYear: boolean } => {
  const currentYear = now.getFullYear();
  const isCurrentYear = year === currentYear;

  return {
    startDate: `${year}-01-01`,
    endDate: isCurrentYear ? getTodayISO() : `${year}-12-31`,
    isCurrentYear,
  };
};

export const resolveYearToDateFileSuffix = (year: number, now: Date = new Date()): string => {
  const { isCurrentYear } = resolveYearToDateRange(year, now);
  if (!isCurrentYear) {
    return 'anual_completo';
  }

  return `${DATA_MAINTENANCE_MONTH_NAMES[now.getMonth()]}_${String(now.getDate()).padStart(2, '0')}`;
};

export const downloadJsonBackup = async (payload: unknown, fileName: string): Promise<void> => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const { saveAs } = await import('file-saver');
  saveAs(blob, fileName);
};
