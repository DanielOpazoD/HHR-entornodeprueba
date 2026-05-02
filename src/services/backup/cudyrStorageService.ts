/**
 * CUDYR Storage Service
 * Handles uploading CUDYR Excel files to Firebase Storage
 *
 * Storage structure:
 * cudyr-backup/
 *   2026/
 *     01/
 *       08-01-2026 - CUDYR.xlsx
 */

import { ref, uploadBytes, getDownloadURL, getMetadata } from 'firebase/storage';
import { defaultBackupStorageRuntime } from '@/services/firebase-runtime/backupRuntime';
import type { BackupStorageRuntime } from '@/services/firebase-runtime/backupRuntime';
import {
  createListYears,
  createListMonths,
  createListFilesInMonth,
  createListFilesInMonthWithReport,
  BaseStoredFile,
} from '@/services/backup/baseStorageService';
import {
  isExpectedStorageLookupMiss,
  shouldLogStorageError,
  resolveStorageLookupStatus,
  toStorageOperationalError,
} from '@/services/backup/storageErrorPolicy';
import {
  isBackupDateValidationError,
  parseBackupDateParts,
} from '@/services/backup/storageContracts';
import { measureStorageOperation } from '@/services/backup/storageObservability';
import { assertStorageAvailable } from '@/services/backup/storageAvailability';
import {
  createStorageLookupResult,
  type StorageLookupResult,
} from '@/services/backup/storageLookupContracts';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import {
  createBackupMutationResultFromError,
  resolveBackupStorage,
  resolveDeleteMutationStatus,
  runStorageLookupWithTimeout,
  type BackupStorageMutationResult,
} from '@/services/backup/backupStorageRuntimeSupport';

// ============= Types =============

export interface StoredCudyrFile extends BaseStoredFile {
  month: string;
  year: string;
}

// ============= Constants =============

const STORAGE_ROOT = 'cudyr-backup';

// ============= Helper Functions =============

/**
 * Generate file path for a CUDYR Excel backup
 * New format: DD-MM-YYYY - CUDYR.xlsx
 */
const generateCudyrPath = (date: string): string => {
  const { year, month, day } = parseBackupDateParts(date, 'CudyrStorage');
  const formattedDate = `${day}-${month}-${year}`;
  const filename = `${formattedDate} - CUDYR.xlsx`;
  return `${STORAGE_ROOT}/${year}/${month}/${filename}`;
};

/**
 * Parse file path to extract metadata
 * Supports both old format (CUDYR_DD-MM-YYYY.xlsx) and new format (DD-MM-YYYY - CUDYR.xlsx)
 */
const parseFilePath = (path: string): { date: string; year: string; month: string } | null => {
  // New format: DD-MM-YYYY - CUDYR.xlsx
  const newMatch = path.match(/(\d{2})-(\d{2})-(\d{4}) - CUDYR\.xlsx$/);
  if (newMatch) {
    return {
      date: `${newMatch[3]}-${newMatch[2]}-${newMatch[1]}`, // YYYY-MM-DD
      year: newMatch[3],
      month: newMatch[2],
    };
  }

  // Old format: CUDYR_DD-MM-YYYY.xlsx (backwards compatibility)
  const oldMatch = path.match(/CUDYR_(\d{2})-(\d{2})-(\d{4})\.xlsx$/);
  if (oldMatch) {
    return {
      date: `${oldMatch[3]}-${oldMatch[2]}-${oldMatch[1]}`, // YYYY-MM-DD
      year: oldMatch[3],
      month: oldMatch[2],
    };
  }
  return null;
};

interface CudyrStorageService {
  uploadCudyrExcel: (excelBlob: Blob, date: string) => Promise<string>;
  uploadCudyrExcelWithResult: (
    excelBlob: Blob,
    date: string
  ) => Promise<BackupStorageMutationResult<string>>;
  cudyrExists: (date: string) => Promise<boolean>;
  cudyrExistsDetailed: (date: string) => Promise<StorageLookupResult>;
  deleteCudyrFile: (date: string) => Promise<void>;
  deleteCudyrFileWithResult: (date: string) => Promise<BackupStorageMutationResult>;
}

// ============= Core Functions =============

/**
 * Upload a CUDYR Excel to Firebase Storage
 */
export const createCudyrStorageService = (
  runtime: BackupStorageRuntime = defaultBackupStorageRuntime
): CudyrStorageService => {
  const uploadCudyrExcelWithResult = async (
    excelBlob: Blob,
    date: string
  ): Promise<BackupStorageMutationResult<string>> => {
    try {
      const storage = await resolveBackupStorage(runtime);
      assertStorageAvailable(storage, 'CudyrStorage', 'uploadCudyrExcel');

      const filePath = generateCudyrPath(date);

      try {
        const { year, month, day } = parseBackupDateParts(date, 'CudyrStorage');
        const legacyFilename = `CUDYR_${day}-${month}-${year}.xlsx`;
        const legacyPath = `${STORAGE_ROOT}/${year}/${month}/${legacyFilename}`;
        const legacyRef = ref(storage, legacyPath);
        await getMetadata(legacyRef);
        const { deleteObject } = await import('firebase/storage');
        await deleteObject(legacyRef);
      } catch (_ignore) {
        // Legacy file doesn't exist, proceed normally
      }

      const storageRef = ref(storage, filePath);
      const user = runtime.auth.currentUser;
      const metadata = {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        customMetadata: {
          date,
          uploadedBy: user?.email || 'unknown',
          uploadedAt: new Date().toISOString(),
        },
      };

      await uploadBytes(storageRef, excelBlob, metadata);
      const downloadUrl = await getDownloadURL(storageRef);
      return { status: 'success', data: downloadUrl };
    } catch (error) {
      if (isBackupDateValidationError(error)) {
        return createBackupMutationResultFromError<string>(error, { invalidDate: true });
      }
      return createBackupMutationResultFromError<string>(error);
    }
  };

  const deleteCudyrFileWithResult = async (date: string): Promise<BackupStorageMutationResult> => {
    const storage = await resolveBackupStorage(runtime);
    const { deleteObject } = await import('firebase/storage');
    let filePath: string;
    try {
      filePath = generateCudyrPath(date);
    } catch (error) {
      if (isBackupDateValidationError(error)) {
        return createBackupMutationResultFromError(error, { invalidDate: true });
      }
      return createBackupMutationResultFromError(error);
    }
    const storageRef = ref(storage, filePath);
    try {
      await deleteObject(storageRef);
      return { status: 'success', data: null };
    } catch (error: unknown) {
      if (isExpectedStorageLookupMiss(error)) {
        return {
          status: resolveDeleteMutationStatus(error),
          error,
          data: null,
        };
      }
      return createBackupMutationResultFromError(error);
    }
  };

  const cudyrExistsDetailed = async (date: string): Promise<StorageLookupResult> => {
    const TIMEOUT_MS = 4000;
    const checkPromise = measureStorageOperation(
      'cudyrExists',
      async (): Promise<StorageLookupResult> => {
        try {
          const storage = await resolveBackupStorage(runtime);

          const filePath = generateCudyrPath(date);
          const storageRef = ref(storage, filePath);

          await getMetadata(storageRef);
          return createStorageLookupResult(true, 'available');
        } catch (error: unknown) {
          if (isExpectedStorageLookupMiss(error) || isBackupDateValidationError(error)) {
            return createStorageLookupResult(
              false,
              resolveStorageLookupStatus(error, {
                invalidDate: isBackupDateValidationError(error),
              })
            );
          }
          if (shouldLogStorageError(error)) {
            recordOperationalErrorTelemetry(
              'backup',
              'cudyr_exists_detailed',
              error,
              toStorageOperationalError(error, {
                code: 'cudyr_exists_lookup_failed',
                message: `No fue posible verificar el respaldo CUDYR ${date}.`,
                context: { date },
                userSafeMessage: 'No fue posible verificar la disponibilidad del respaldo CUDYR.',
              }),
              { context: { date } }
            );
          }
          return createStorageLookupResult(false, resolveStorageLookupStatus(error));
        }
      },
      { context: date }
    );

    return runStorageLookupWithTimeout(checkPromise, TIMEOUT_MS, () => {
      recordOperationalTelemetry({
        category: 'backup',
        operation: 'cudyr_exists_timeout',
        status: 'degraded',
        date,
        issues: ['La verificacion del respaldo CUDYR excedio el tiempo esperado.'],
      });
    });
  };

  return {
    uploadCudyrExcel: async (excelBlob, date): Promise<string> => {
      const result = await uploadCudyrExcelWithResult(excelBlob, date);
      if (result.status !== 'success') {
        throw result.error;
      }
      return result.data as string;
    },
    uploadCudyrExcelWithResult,
    cudyrExists: async (date: string): Promise<boolean> => {
      const result = await cudyrExistsDetailed(date);
      return result.exists;
    },
    cudyrExistsDetailed,
    deleteCudyrFile: async (date: string): Promise<void> => {
      const result = await deleteCudyrFileWithResult(date);
      if (
        result.status !== 'success' &&
        result.status !== 'not_found' &&
        result.status !== 'invalid_date'
      ) {
        throw result.error;
      }
    },
    deleteCudyrFileWithResult,
  };
};

const cudyrStorageService = createCudyrStorageService();
export const uploadCudyrExcel = cudyrStorageService.uploadCudyrExcel;
export const uploadCudyrExcelWithResult = cudyrStorageService.uploadCudyrExcelWithResult;
export const cudyrExists = cudyrStorageService.cudyrExists;
export const cudyrExistsDetailed = cudyrStorageService.cudyrExistsDetailed;
export const deleteCudyrFile = cudyrStorageService.deleteCudyrFile;
export const deleteCudyrFileWithResult = cudyrStorageService.deleteCudyrFileWithResult;

/**
 * Check if a CUDYR backup exists for a date
 */

/**
 * List all years with CUDYR backups
 */
export const listCudyrYears = createListYears(STORAGE_ROOT);

/**
 * List all months in a year
 */
export const listCudyrMonths = createListMonths(STORAGE_ROOT);

/**
 * List all files in a month
 * Note: Display name is normalized to new format (DD-MM-YYYY - CUDYR.xlsx)
 * even for older files stored with the old naming convention.
 */
export const listCudyrFilesInMonth = createListFilesInMonth<
  StoredCudyrFile,
  { date: string; year: string; month: string }
>({
  storageRoot: STORAGE_ROOT,
  parseFilePath,
  mapToFile: (item, metadata, downloadUrl, parsed) => {
    // Generate normalized display name from parsed date (DD-MM-YYYY - CUDYR.xlsx)
    const [year, month, day] = parsed.date.split('-');
    const displayName = `${day}-${month}-${year} - CUDYR.xlsx`;

    return {
      name: displayName, // Always use normalized format for display
      fullPath: item.fullPath,
      downloadUrl,
      date: parsed.date,
      year: parsed.year as string,
      month: parsed.month as string,
      createdAt: metadata.customMetadata?.uploadedAt || metadata.timeCreated,
      size: metadata.size,
    };
  },
});

export const listCudyrFilesInMonthWithReport = createListFilesInMonthWithReport<
  StoredCudyrFile,
  { date: string; year: string; month: string }
>({
  storageRoot: STORAGE_ROOT,
  parseFilePath,
  mapToFile: (item, metadata, downloadUrl, parsed) => {
    const [year, month, day] = parsed.date.split('-');
    const displayName = `${day}-${month}-${year} - CUDYR.xlsx`;

    return {
      name: displayName,
      fullPath: item.fullPath,
      downloadUrl,
      date: parsed.date,
      year: parsed.year as string,
      month: parsed.month as string,
      createdAt: metadata.customMetadata?.uploadedAt || metadata.timeCreated,
      size: metadata.size,
    };
  },
});
