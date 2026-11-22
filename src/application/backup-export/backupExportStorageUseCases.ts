import type { BackupItem, BackupType } from '@/hooks/backupFileBrowserContracts';
import type { BaseStoredFile, StorageListReport, StoredPdfFile } from '@/types/backupArtifacts';
import type { StorageLookupResult } from '@/services/backup/storageLookupContracts';
import {
  createApplicationDegraded,
  createApplicationFailed,
  createApplicationSuccess,
} from '@/shared/contracts/applicationOutcomeFactories';
import type { ApplicationOutcome } from '@/shared/contracts/applicationOutcomeTypes';

import {
  deleteBackupArchiveFile,
  lookupBackupArchiveStatus,
  resolveBackupStorageListServices,
} from '@/application/backup-export/backupStorageResolvers';
import { findMonthIndexByName } from '@/constants/export';

const EMPTY_STORAGE_LIST_REPORT: StorageListReport = {
  skippedNotFound: 0,
  skippedRestricted: 0,
  skippedUnknown: 0,
  skippedUnparsed: 0,
  timedOut: false,
};

const monthNameToNumber = (name: string): string => {
  const index = findMonthIndexByName(name);
  return String(index + 1).padStart(2, '0');
};

const hasDegradedStorageListReport = (report: StorageListReport): boolean =>
  report.timedOut ||
  report.skippedRestricted > 0 ||
  report.skippedUnknown > 0 ||
  report.skippedUnparsed > 0;

export interface LookupBackupArchiveStatusInput {
  backupType: BackupType;
  date: string;
  shift?: 'day' | 'night';
}

export interface LookupBackupArchiveStatusOutput {
  exists: boolean;
  lookup: StorageLookupResult;
}

export const executeLookupBackupArchiveStatus = async ({
  backupType,
  date,
  shift = 'day',
}: LookupBackupArchiveStatusInput): Promise<
  ApplicationOutcome<LookupBackupArchiveStatusOutput>
> => {
  try {
    const lookup = await lookupBackupArchiveStatus(backupType, date, shift);

    const data = { exists: lookup.exists, lookup };
    if (lookup.status === 'restricted' || lookup.status === 'timeout') {
      return createApplicationDegraded(data, [
        {
          kind: 'unknown',
          message:
            lookup.status === 'restricted'
              ? 'No se pudo confirmar el respaldo por permisos de Storage.'
              : 'La verificación del respaldo excedió el tiempo esperado.',
        },
      ]);
    }

    return createApplicationSuccess(data);
  } catch (error) {
    return createApplicationFailed(
      {
        exists: false,
        lookup: { exists: false, status: 'error' },
      },
      [
        {
          kind: 'unknown',
          message:
            error instanceof Error ? error.message : 'Error al verificar el respaldo remoto.',
        },
      ]
    );
  }
};

export interface ListBackupFilesInput {
  backupType: BackupType;
  path: string[];
}

export interface ListBackupFilesOutput {
  items: BackupItem[];
  report: StorageListReport;
}

export const executeListBackupFiles = async ({
  backupType,
  path,
}: ListBackupFilesInput): Promise<ApplicationOutcome<ListBackupFilesOutput>> => {
  try {
    const service = await resolveBackupStorageListServices(backupType);

    if (path.length === 0) {
      const years = await service.listYears();
      return createApplicationSuccess({
        items: years.map(year => ({
          type: 'folder',
          data: { name: year, type: 'year' as const },
        })),
        report: EMPTY_STORAGE_LIST_REPORT,
      });
    }

    const [yearSegment, monthSegment] = path;

    if (path.length === 1 && yearSegment !== undefined) {
      const months = await service.listMonths(yearSegment);
      return createApplicationSuccess({
        items: months.map(month => ({
          type: 'folder',
          data: { name: month.name, number: month.number, type: 'month' as const },
        })),
        report: EMPTY_STORAGE_LIST_REPORT,
      });
    }

    if (path.length === 2 && yearSegment !== undefined && monthSegment !== undefined) {
      const filesResult = await service.listFilesInMonthWithReport(
        yearSegment,
        monthNameToNumber(monthSegment)
      );
      const data = {
        items: filesResult.files.map(file => ({
          type: 'file' as const,
          data: file,
        })),
        report: filesResult.report,
      };

      if (hasDegradedStorageListReport(filesResult.report)) {
        return createApplicationDegraded(data, [
          {
            kind: 'unknown',
            message: 'La lista remota de respaldos quedó incompleta o degradada.',
          },
        ]);
      }

      return createApplicationSuccess(data);
    }

    return createApplicationSuccess({ items: [], report: EMPTY_STORAGE_LIST_REPORT });
  } catch (error) {
    return createApplicationFailed({ items: [], report: EMPTY_STORAGE_LIST_REPORT }, [
      {
        kind: 'unknown',
        message: error instanceof Error ? error.message : 'Error al cargar respaldos remotos.',
      },
    ]);
  }
};

export interface DeleteBackupFileInput {
  backupType: BackupType;
  file: BaseStoredFile | StoredPdfFile;
}

export const executeDeleteBackupFile = async (
  input: DeleteBackupFileInput
): Promise<ApplicationOutcome<null>> => {
  try {
    await deleteBackupArchiveFile(input.backupType, input.file);
    return createApplicationSuccess(null);
  } catch (error) {
    return createApplicationFailed(null, [
      {
        kind: 'unknown',
        message: error instanceof Error ? error.message : 'Error al eliminar archivo',
      },
    ]);
  }
};
