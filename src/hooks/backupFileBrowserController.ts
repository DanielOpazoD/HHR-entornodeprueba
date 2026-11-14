import { getClinicalCalendarDateISO } from '@/utils/clinicalTimeZone';
import type { BackupFolder } from '@/hooks/backupFileBrowserContracts';
import type { BaseStoredFile, StoredPdfFile } from '@/types/backupArtifacts';
import { MONTH_NAMES } from '@/types/backupArtifacts';
import { canUseAdminMaintenanceActions } from '@/shared/access/operationalAccessPolicy';

export type BackupBrowserType = 'handoff' | 'census' | 'cudyr';

export type BackupBrowserItem = {
  type: 'folder' | 'file';
  data: BackupFolder | BaseStoredFile | StoredPdfFile;
};

export const buildInitialBackupBrowserPath = (now: Date = new Date()): string[] => {
  const today = getClinicalCalendarDateISO(now);
  return [today.slice(0, 4), MONTH_NAMES[Number(today.slice(5, 7)) - 1]];
};

export const filterBackupBrowserItems = (
  items: BackupBrowserItem[],
  searchQuery: string
): BackupBrowserItem[] => {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) return items;

  return items.filter(item => {
    if (item.type === 'folder') {
      return (item.data as BackupFolder).name.toLowerCase().includes(normalizedQuery);
    }

    const file = item.data as BaseStoredFile;
    return (
      file.name.toLowerCase().includes(normalizedQuery) ||
      Boolean(file.date?.toLowerCase().includes(normalizedQuery))
    );
  });
};

export const resolveCanRunMagicBackfill = (
  role: string | undefined,
  path: string[],
  isLoading: boolean
): boolean => canUseAdminMaintenanceActions(role) && path.length === 2 && !isLoading;

export const resolveBackupModuleLabel = (backupType: BackupBrowserType): string =>
  backupType === 'handoff' ? 'Entregas' : backupType === 'census' ? 'Censo' : 'CUDYR';
