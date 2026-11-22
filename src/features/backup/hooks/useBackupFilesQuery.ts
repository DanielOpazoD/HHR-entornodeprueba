/**
 * useBackupFilesQuery Hook
 * TanStack Query wrapper for backup file listing.
 * Natively resolves race conditions when navigating between folders.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { StorageListReport } from '@/types/backupArtifacts';
import { executeListBackupFiles } from '@/application/backup-export/backupExportStorageUseCases';
import type {
  BackupFolder,
  BackupItem,
  BackupItemType,
  BackupType,
} from '@/hooks/backupFileBrowserContracts';
import { recordOperationalOutcome } from '@/services/observability/operationalTelemetryOutcomeRecorder';
export type { BackupFolder, BackupItem, BackupItemType };

export const EMPTY_STORAGE_LIST_REPORT: StorageListReport = {
  skippedNotFound: 0,
  skippedRestricted: 0,
  skippedUnknown: 0,
  skippedUnparsed: 0,
  timedOut: false,
};

export const useBackupFilesQuery = (backupType: string, path: string[]) => {
  const query = useQuery({
    queryKey: ['backups', backupType, ...path],
    queryFn: async () => {
      return executeListBackupFiles({ backupType: backupType as BackupType, path });
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    // A failed listing comes back as data, not as a query error, so it would not count as
    // stale; re-list after every reconnect so an offline failure recovers on its own.
    refetchOnReconnect: 'always',
  });

  const listingOutcome = query.data;

  useEffect(() => {
    if (!listingOutcome) return;
    recordOperationalOutcome('backup', 'list_backup_files', listingOutcome, {
      context: { backupType, depth: path.length },
    });
  }, [backupType, listingOutcome, path.length]);

  return {
    ...query,
    data: listingOutcome?.data.items ?? [],
    storageReport: listingOutcome?.data.report ?? EMPTY_STORAGE_LIST_REPORT,
    listingOutcome,
  };
};
