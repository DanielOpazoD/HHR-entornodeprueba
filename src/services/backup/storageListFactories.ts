import { getDownloadURL, getMetadata, listAll, ref, type StorageReference } from 'firebase/storage';
import { defaultBackupStorageRuntime } from '@/services/firebase-runtime/backupRuntime';
import type { BackupStorageRuntime } from '@/services/firebase-runtime/backupRuntime';
import {
  classifyStorageError,
  isExpectedStorageLookupMiss,
  shouldLogStorageError,
  toStorageOperationalError,
} from '@/services/backup/storageErrorPolicy';
import { measureStorageOperation } from '@/services/backup/storageObservability';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { MONTH_NAMES } from '@/constants/export';
import {
  createStorageListReport,
  DEFAULT_FILE_INFO_CONCURRENCY,
  DEFAULT_FILES_TIMEOUT_MS,
  DEFAULT_LIST_TIMEOUT_MS,
  mapWithConcurrency,
} from './storageListSupport';
import type { ListFilesConfig, MonthInfo, StorageListResult } from './storageListSupport';
import type { BaseStoredFile } from '@/types/backupArtifacts';
import { withStorageDeadline } from './storageLookupContracts';
import { resolveBackupStorage } from '@/services/backup/backupStorageRuntimeSupport';

const folderListTimedOut = (): never => {
  throw new Error('La consulta de carpetas de respaldo excedió el tiempo de espera.');
};

export const createListYears = (storageRoot: string) => {
  return async (
    runtime: Pick<BackupStorageRuntime, 'ready' | 'getStorage'> = defaultBackupStorageRuntime
  ): Promise<string[]> => {
    try {
      const listPromise = measureStorageOperation(
        'listStorageYears',
        async () => {
          const storage = await resolveBackupStorage(runtime);
          const rootRef = ref(storage, storageRoot);
          const result = await listAll(rootRef);
          return result.prefixes
            .map(prefix => prefix.name)
            .filter(name => /^\d{4}$/.test(name))
            .sort((a, b) => b.localeCompare(a));
        },
        { context: storageRoot }
      );

      return await withStorageDeadline(listPromise, DEFAULT_LIST_TIMEOUT_MS, folderListTimedOut);
    } catch (error: unknown) {
      if (classifyStorageError(error) === 'not_found') {
        return [];
      }
      if (shouldLogStorageError(error)) {
        recordOperationalErrorTelemetry(
          'backup',
          'list_storage_years',
          error,
          toStorageOperationalError(error, {
            code: 'backup_list_years_failed',
            message: `No fue posible listar años de respaldo para ${storageRoot}.`,
            context: { storageRoot },
            userSafeMessage: 'No fue posible listar años disponibles del respaldo.',
          }),
          { context: { storageRoot } }
        );
      }
      throw error;
    }
  };
};

export const createListMonths = (storageRoot: string) => {
  return async (
    year: string,
    runtime: Pick<BackupStorageRuntime, 'ready' | 'getStorage'> = defaultBackupStorageRuntime
  ): Promise<MonthInfo[]> => {
    try {
      const listPromise = measureStorageOperation(
        'listStorageMonths',
        async () => {
          const storage = await resolveBackupStorage(runtime);
          const yearRef = ref(storage, `${storageRoot}/${year}`);
          const result = await listAll(yearRef);
          return result.prefixes
            .map(prefix => ({
              number: prefix.name,
              name: MONTH_NAMES[parseInt(prefix.name, 10) - 1] || prefix.name,
            }))
            .sort((a, b) => b.number.localeCompare(a.number));
        },
        { context: `${storageRoot}/${year}` }
      );

      return await withStorageDeadline(listPromise, DEFAULT_LIST_TIMEOUT_MS, folderListTimedOut);
    } catch (error: unknown) {
      if (classifyStorageError(error) === 'not_found') {
        return [];
      }
      if (shouldLogStorageError(error)) {
        recordOperationalErrorTelemetry(
          'backup',
          'list_storage_months',
          error,
          toStorageOperationalError(error, {
            code: 'backup_list_months_failed',
            message: `No fue posible listar meses de respaldo para ${storageRoot}/${year}.`,
            context: { storageRoot, year },
            userSafeMessage: 'No fue posible listar meses disponibles del respaldo.',
          }),
          { context: { storageRoot, year } }
        );
      }
      throw error;
    }
  };
};

const createFileInfoMapper = <T extends BaseStoredFile, TParsed extends { date: string }>(
  config: ListFilesConfig<T, TParsed>,
  fullStoragePath: string,
  report: ReturnType<typeof createStorageListReport>
) => {
  return async (item: StorageReference) => {
    try {
      const [metadata, downloadUrl] = await Promise.all([getMetadata(item), getDownloadURL(item)]);
      const parsed = config.parseFilePath(item.fullPath);

      if (parsed) {
        return config.mapToFile(item, metadata, downloadUrl, parsed);
      }

      report.skippedUnparsed += 1;
      recordOperationalTelemetry({
        category: 'backup',
        operation: 'list_storage_file_unparsed',
        status: 'degraded',
        issues: ['Se omitio un archivo de respaldo por formato no reconocido.'],
        context: { fullStoragePath, filePath: item.fullPath },
      });
      return null;
    } catch (error: unknown) {
      const category = classifyStorageError(error);
      if (category === 'not_found') {
        report.skippedNotFound += 1;
        return null;
      }
      if (category === 'permission_denied' || category === 'unauthenticated') {
        report.skippedRestricted += 1;
        return null;
      }

      report.skippedUnknown += 1;
      if (shouldLogStorageError(error)) {
        recordOperationalErrorTelemetry(
          'backup',
          'get_storage_file_info',
          error,
          toStorageOperationalError(error, {
            code: 'backup_get_file_info_failed',
            message: `No fue posible leer el archivo ${item.name}.`,
            context: { fullStoragePath, fileName: item.name },
            userSafeMessage: 'No fue posible leer uno de los archivos del respaldo.',
          }),
          { context: { fullStoragePath, fileName: item.name } }
        );
      }
      return null;
    }
  };
};

export const createListFilesInMonthWithReport = <
  T extends BaseStoredFile,
  TParsed extends { date: string } = { date: string },
>(
  config: ListFilesConfig<T, TParsed>
) => {
  return async (
    year: string,
    month: string,
    runtime: Pick<BackupStorageRuntime, 'ready' | 'getStorage'> = defaultBackupStorageRuntime
  ): Promise<StorageListResult<T>> => {
    const fullStoragePath = `${config.storageRoot}/${year}/${month}`;
    const report = createStorageListReport();

    try {
      const listPromise = measureStorageOperation(
        'listStorageFilesInMonth',
        async () => {
          const storage = await resolveBackupStorage(runtime);
          const monthRef = ref(storage, fullStoragePath);
          const result = await listAll(monthRef);

          if (result.items.length === 0) {
            return { files: [], report };
          }

          const filesWithNulls = await mapWithConcurrency(
            result.items,
            DEFAULT_FILE_INFO_CONCURRENCY,
            createFileInfoMapper(config, fullStoragePath, report)
          );
          const files = filesWithNulls.filter(file => file !== null) as T[];

          return {
            files: files.sort((a, b) => b.date.localeCompare(a.date)),
            report: { ...report },
          };
        },
        { context: fullStoragePath }
      );

      return await withStorageDeadline(listPromise, DEFAULT_FILES_TIMEOUT_MS, () => {
        recordOperationalTelemetry({
          category: 'backup',
          operation: 'list_storage_files_timeout',
          status: 'degraded',
          issues: ['La consulta de respaldo excedió el tiempo esperado.'],
          context: { fullStoragePath },
        });
        return { files: [], report: { ...report, timedOut: true } };
      });
    } catch (error: unknown) {
      if (isExpectedStorageLookupMiss(error)) {
        report.skippedRestricted += 1;
        return { files: [], report };
      }
      if (shouldLogStorageError(error)) {
        recordOperationalErrorTelemetry(
          'backup',
          'list_storage_files',
          error,
          toStorageOperationalError(error, {
            code: 'backup_list_files_failed',
            message: `No fue posible listar archivos para ${fullStoragePath}.`,
            context: { fullStoragePath },
            userSafeMessage: 'No fue posible listar archivos del respaldo.',
          }),
          { context: { fullStoragePath } }
        );
      }
      report.skippedUnknown += 1;
      return { files: [], report };
    }
  };
};
