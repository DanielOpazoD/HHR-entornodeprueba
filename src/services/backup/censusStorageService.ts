/**
 * Census Storage Service
 * Handles uploading and managing Census Excel files in Firebase Storage
 */

import { ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { defaultBackupStorageRuntime } from '@/services/firebase-runtime/backupRuntime';
import type { BackupStorageRuntime } from '@/services/firebase-runtime/backupRuntime';
import {
  createListYears,
  createListMonths,
  createListFilesInMonthWithReport,
} from './baseStorageService';
import type { BaseStoredFile } from '@/types/backupArtifacts';
import {
  isExpectedStorageLookupMiss,
  shouldLogStorageError,
  resolveStorageLookupStatus,
  toStorageOperationalError,
} from './storageErrorPolicy';
import { isBackupDateValidationError, parseBackupDateParts } from './storageContracts';
import { measureStorageOperation } from './storageObservability';
import { assertStorageAvailable } from './storageAvailability';
import { createStorageLookupResult, type StorageLookupResult } from './storageLookupContracts';
import { recordOperationalErrorTelemetry } from '@/services/observability/operationalTelemetryOutcomeRecorder';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import {
  createBackupMutationResultFromError,
  resolveBackupStorage,
  resolveDeleteMutationStatus,
  runStorageLookupWithTimeout,
  type BackupStorageMutationResult,
} from './backupStorageRuntimeSupport';

// ============= Constants =============

const STORAGE_ROOT = 'censo-diario';

// ============= Helper Functions =============

/**
 * Generate file path for a Census Excel
 */
const generateCensusPath = (date: string): string => {
  const { year, month, day } = parseBackupDateParts(date, 'CensusStorage');
  const formattedDate = `${day}-${month}-${year}`;
  const filename = `${formattedDate} - Censo Diario.xlsx`;
  return `${STORAGE_ROOT}/${year}/${month}/${filename}`;
};

const generateCensusMonthPath = (date: string): string => {
  const { year, month } = parseBackupDateParts(date, 'CensusStorage');
  return `${STORAGE_ROOT}/${year}/${month}`;
};

const generateCensusFilename = (date: string): string => {
  const { year, month, day } = parseBackupDateParts(date, 'CensusStorage');
  return `${day}-${month}-${year} - Censo Diario.xlsx`;
};

/**
 * Parse file path to extract date
 */
const parseFilePath = (path: string): { date: string } | null => {
  // Check if path ends with "DD-MM-YYYY - Censo Diario.xlsx"
  const match = path.match(/(\d{2})-(\d{2})-(\d{4}) - Censo Diario\.xlsx$/);
  if (match) {
    return {
      date: `${match[3]}-${match[2]}-${match[1]}`, // Convert back to YYYY-MM-DD
    };
  }
  return null;
};

interface CensusStorageService {
  uploadCensus: (excelBlob: Blob, date: string) => Promise<string>;
  uploadCensusWithResult: (
    excelBlob: Blob,
    date: string
  ) => Promise<BackupStorageMutationResult<string>>;
  checkCensusExists: (date: string) => Promise<boolean>;
  checkCensusExistsDetailed: (date: string) => Promise<StorageLookupResult>;
  deleteCensusFile: (date: string) => Promise<void>;
  deleteCensusFileWithResult: (date: string) => Promise<BackupStorageMutationResult>;
}

// ============= Core Functions =============

/**
 * Upload a Census Excel to Firebase Storage
 */
export const createCensusStorageService = (
  runtime: BackupStorageRuntime = defaultBackupStorageRuntime
): CensusStorageService => {
  const uploadCensusWithResult = async (
    excelBlob: Blob,
    date: string
  ): Promise<BackupStorageMutationResult<string>> => {
    try {
      const storage = await resolveBackupStorage(runtime);
      assertStorageAvailable(storage, 'CensusStorage', 'uploadCensus');

      const filePath = generateCensusPath(date);
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

  const checkCensusExistsDetailed = async (date: string): Promise<StorageLookupResult> => {
    const TIMEOUT_MS = 4000;
    const checkPromise = measureStorageOperation(
      'censusExists',
      async (): Promise<StorageLookupResult> => {
        try {
          const storage = await resolveBackupStorage(runtime);
          const monthRef = ref(storage, generateCensusMonthPath(date));
          const expectedFilename = generateCensusFilename(date);
          const result = await listAll(monthRef);
          const exists = result.items.some(item => item.name === expectedFilename);
          return createStorageLookupResult(exists, exists ? 'available' : 'missing');
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
              'census_exists_detailed',
              error,
              toStorageOperationalError(error, {
                code: 'census_exists_lookup_failed',
                message: `No fue posible verificar el censo ${date}.`,
                context: { date },
                userSafeMessage: 'No fue posible verificar la disponibilidad del censo.',
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
        operation: 'census_exists_timeout',
        status: 'degraded',
        date,
        issues: ['La verificacion del censo excedio el tiempo esperado.'],
      });
    });
  };

  const deleteCensusFileWithResult = async (date: string): Promise<BackupStorageMutationResult> => {
    const storage = await resolveBackupStorage(runtime);
    let filePath: string;
    try {
      filePath = generateCensusPath(date);
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

  return {
    uploadCensus: async (excelBlob, date): Promise<string> => {
      const result = await uploadCensusWithResult(excelBlob, date);
      if (result.status !== 'success') {
        throw result.error;
      }
      return result.data as string;
    },
    uploadCensusWithResult,
    checkCensusExists: async (date: string): Promise<boolean> => {
      const result = await checkCensusExistsDetailed(date);
      return result.exists;
    },
    checkCensusExistsDetailed,
    deleteCensusFile: async (date: string): Promise<void> => {
      const result = await deleteCensusFileWithResult(date);
      if (
        result.status !== 'success' &&
        result.status !== 'not_found' &&
        result.status !== 'invalid_date'
      ) {
        throw result.error;
      }
    },
    deleteCensusFileWithResult,
  };
};

const censusStorageService = createCensusStorageService();
export const uploadCensus = censusStorageService.uploadCensus;
export const uploadCensusWithResult = censusStorageService.uploadCensusWithResult;
export const checkCensusExists = censusStorageService.checkCensusExists;
export const checkCensusExistsDetailed = censusStorageService.checkCensusExistsDetailed;
export const deleteCensusFile = censusStorageService.deleteCensusFile;
export const deleteCensusFileWithResult = censusStorageService.deleteCensusFileWithResult;

/**
 * Check if a Census file exists for a given date
 */

/**
 * List all years with Census files (using base service)
 */
export const listCensusYears = createListYears(STORAGE_ROOT);

/**
 * List all months in a year for Census (using base service)
 */
export const listCensusMonths = createListMonths(STORAGE_ROOT);

/**
 * List all Census files in a month (using base service)
 * Note: Display name is normalized to format (DD-MM-YYYY - Censo Diario.xlsx)
 */
export const listCensusFilesInMonthWithReport = createListFilesInMonthWithReport<
  BaseStoredFile,
  { date: string }
>({
  storageRoot: STORAGE_ROOT,
  parseFilePath,
  mapToFile: (item, metadata, downloadUrl, parsed) => {
    const [year, month, day] = parsed.date.split('-');
    const displayName = `${day}-${month}-${year} - Censo Diario.xlsx`;

    return {
      name: displayName,
      fullPath: item.fullPath,
      downloadUrl,
      date: parsed.date,
      createdAt: metadata.customMetadata?.uploadedAt || metadata.timeCreated,
      size: metadata.size,
    };
  },
});
