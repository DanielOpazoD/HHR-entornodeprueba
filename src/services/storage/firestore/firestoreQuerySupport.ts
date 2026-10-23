import { DailyRecord } from '@/services/storage/storageDailyRecordContracts';

const padDatePart = (value: number): string => String(value).padStart(2, '0');

export const buildFirestoreMonthDateRange = (
  year: number,
  monthIndex: number
): { startDate: string; endDate: string } => ({
  startDate: `${year}-${padDatePart(monthIndex + 1)}-01`,
  endDate: `${year}-${padDatePart(monthIndex + 1)}-31`,
});

type FirestoreDocLike<T> = { id: string; data: () => T };

export const mapFirestoreRecords = <T>(
  docsOrSnapshot:
    | Array<FirestoreDocLike<T>>
    | {
        docs?: Array<FirestoreDocLike<T>>;
        forEach?: (callback: (doc: FirestoreDocLike<T>) => void) => void;
      },
  mapper: (data: T, id: string) => DailyRecord
): DailyRecord[] => {
  if (Array.isArray(docsOrSnapshot)) {
    return docsOrSnapshot.map(docItem => mapper(docItem.data(), docItem.id));
  }

  if (Array.isArray(docsOrSnapshot.docs)) {
    return docsOrSnapshot.docs.map(docItem => mapper(docItem.data(), docItem.id));
  }

  if (typeof docsOrSnapshot.forEach === 'function') {
    const items: DailyRecord[] = [];
    docsOrSnapshot.forEach(docItem => {
      items.push(mapper(docItem.data(), docItem.id));
    });
    return items;
  }

  return [];
};
