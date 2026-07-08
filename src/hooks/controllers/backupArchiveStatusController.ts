import type { StorageLookupResult } from '@/services/backup/storageLookupContracts';

export const shouldCheckArchiveStatus = (
  currentDateString: string,
  currentModule: string
): boolean =>
  Boolean(currentDateString) && (currentModule === 'CENSUS' || currentModule === 'NURSING_HANDOFF');

export const buildArchiveStatusState = (result: StorageLookupResult): boolean => result.exists;
