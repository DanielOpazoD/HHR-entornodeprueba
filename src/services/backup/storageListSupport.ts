import type { FullMetadata, StorageReference } from 'firebase/storage';

export interface MonthInfo {
  number: string;
  name: string;
}

export interface BaseStoredFile {
  name: string;
  fullPath: string;
  downloadUrl: string;
  date: string;
  createdAt: string;
  size: number;
}

export interface ListFilesConfig<T, TParsed extends { date: string } = { date: string }> {
  storageRoot: string;
  parseFilePath: (path: string) => TParsed | null;
  mapToFile: (
    item: StorageReference,
    metadata: FullMetadata,
    downloadUrl: string,
    parsed: TParsed
  ) => T;
}

export interface StorageListReport {
  skippedNotFound: number;
  skippedRestricted: number;
  skippedUnknown: number;
  skippedUnparsed: number;
  timedOut: boolean;
}

export interface StorageListResult<T> {
  files: T[];
  report: StorageListReport;
}

export const MONTH_NAMES = [
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
];

export const DEFAULT_LIST_TIMEOUT_MS = 5000;
export const DEFAULT_FILES_TIMEOUT_MS = 15000;
export const DEFAULT_FILE_INFO_CONCURRENCY = 6;

export const mapWithConcurrency = async <TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  mapper: (item: TInput, index: number) => Promise<TOutput>
): Promise<TOutput[]> => {
  if (items.length === 0) return [];

  const workers = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<TOutput>(items.length);
  let cursor = 0;

  const runWorker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: workers }, () => runWorker()));
  return results;
};

export const createStorageListReport = (): StorageListReport => ({
  skippedNotFound: 0,
  skippedRestricted: 0,
  skippedUnknown: 0,
  skippedUnparsed: 0,
  timedOut: false,
});
