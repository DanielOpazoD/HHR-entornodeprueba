import type { StorageListReport } from '@/types/backupArtifacts';
import { MONTH_NAMES } from '@/services/backup/baseStorageService';

export const EMPTY_STORAGE_LIST_REPORT: StorageListReport = {
  skippedNotFound: 0,
  skippedRestricted: 0,
  skippedUnknown: 0,
  skippedUnparsed: 0,
  timedOut: false,
};

export const monthNameToNumber = (name: string): string => {
  const index = MONTH_NAMES.indexOf(name);
  return String(index + 1).padStart(2, '0');
};

export const hasDegradedStorageListReport = (report: StorageListReport): boolean =>
  report.timedOut ||
  report.skippedRestricted > 0 ||
  report.skippedUnknown > 0 ||
  report.skippedUnparsed > 0;
