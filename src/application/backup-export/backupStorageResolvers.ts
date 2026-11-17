import type { BackupType } from '@/hooks/backupFileBrowserContracts';
import type { BaseStoredFile, StorageListReport, StoredPdfFile } from '@/types/backupArtifacts';
import type { StorageLookupResult } from '@/services/backup/storageLookupContracts';

interface BackupStorageListServices {
  listYears: () => Promise<string[]>;
  listMonths: (year: string) => Promise<Array<{ name: string; number: string }>>;
  listFilesInMonthWithReport: (
    year: string,
    month: string
  ) => Promise<{ files: Array<BaseStoredFile | StoredPdfFile>; report: StorageListReport }>;
}

export const resolveBackupStorageListServices = async (
  backupType: BackupType
): Promise<BackupStorageListServices> => {
  if (backupType === 'handoff') {
    const module = await import('@/services/backup/pdfStorageService');
    return {
      listYears: module.listYears,
      listMonths: module.listMonths,
      listFilesInMonthWithReport: module.listFilesInMonthWithReport,
    };
  }

  if (backupType === 'census') {
    const module = await import('@/services/backup/censusStorageService');
    return {
      listYears: module.listCensusYears,
      listMonths: module.listCensusMonths,
      listFilesInMonthWithReport: module.listCensusFilesInMonthWithReport,
    };
  }

  const module = await import('@/services/backup/cudyrStorageService');
  return {
    listYears: module.listCudyrYears,
    listMonths: module.listCudyrMonths,
    listFilesInMonthWithReport: module.listCudyrFilesInMonthWithReport,
  };
};

export const lookupBackupArchiveStatus = async (
  backupType: BackupType,
  date: string,
  shift: 'day' | 'night'
): Promise<StorageLookupResult> => {
  if (backupType === 'handoff') {
    const module = await import('@/services/backup/pdfStorageService');
    return module.pdfExistsDetailed(date, shift);
  }

  if (backupType === 'census') {
    const module = await import('@/services/backup/censusStorageService');
    return module.checkCensusExistsDetailed(date);
  }

  const module = await import('@/services/backup/cudyrStorageService');
  return module.cudyrExistsDetailed(date);
};

export const deleteBackupArchiveFile = async (
  backupType: BackupType,
  file: BaseStoredFile | StoredPdfFile
): Promise<void> => {
  if (backupType === 'handoff') {
    const module = await import('@/services/backup/pdfStorageService');
    const pdfFile = file as StoredPdfFile;
    await module.deletePdf(pdfFile.date, pdfFile.shiftType);
    return;
  }

  if (backupType === 'census') {
    const module = await import('@/services/backup/censusStorageService');
    await module.deleteCensusFile(file.date);
    return;
  }

  const module = await import('@/services/backup/cudyrStorageService');
  await module.deleteCudyrFile(file.date);
};
