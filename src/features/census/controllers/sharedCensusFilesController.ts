import type { StoredCensusFile } from '@/services/backup/censusStorageService';
import {
  type ControllerError,
  type ControllerResult,
  failWithCode,
  ok,
} from '@/features/census/controllers/controllerResult';

export interface SharedCensusMonthWindow {
  currentYear: string;
  currentMonth: string;
  previousYear: string;
  previousMonth: string;
}

export type SharedCensusFilesLoadErrorCode = 'LIST_FILES_FAILED';
export type SharedCensusDownloadPermissionErrorCode = 'DOWNLOAD_PERMISSION_REQUIRED';

export type SharedCensusFilesLoadError = ControllerError<SharedCensusFilesLoadErrorCode>;
export type SharedCensusDownloadPermissionError =
  ControllerError<SharedCensusDownloadPermissionErrorCode>;

interface SelectLatestSharedCensusFilesParams {
  currentFiles: StoredCensusFile[];
  previousFiles: StoredCensusFile[];
}

export const resolveSharedCensusMonthWindow = (now: Date): SharedCensusMonthWindow => {
  const currentMonthIndex = now.getMonth();
  const currentYear = now.getFullYear();
  const previousMonthIndex = currentMonthIndex === 0 ? 11 : currentMonthIndex - 1;
  const previousYear = currentMonthIndex === 0 ? currentYear - 1 : currentYear;

  return {
    currentYear: currentYear.toString(),
    currentMonth: String(currentMonthIndex + 1).padStart(2, '0'),
    previousYear: previousYear.toString(),
    previousMonth: String(previousMonthIndex + 1).padStart(2, '0'),
  };
};

export const selectLatestSharedCensusFiles = ({
  currentFiles,
  previousFiles,
}: SelectLatestSharedCensusFilesParams): StoredCensusFile[] => {
  const sortedCurrent = [...currentFiles].sort((a, b) => b.date.localeCompare(a.date));
  const sortedPrevious = [...previousFiles].sort((a, b) => b.date.localeCompare(a.date));

  return [sortedCurrent[0], sortedPrevious[0]].filter((file): file is StoredCensusFile => !!file);
};

export const filterSharedCensusFilesByTerm = (
  files: StoredCensusFile[],
  searchTerm: string
): StoredCensusFile[] => {
  const normalizedTerm = searchTerm.trim().toLowerCase();
  if (!normalizedTerm) {
    return files;
  }

  return files.filter(
    file => file.name.toLowerCase().includes(normalizedTerm) || file.date.includes(normalizedTerm)
  );
};

interface ExecuteLoadSharedCensusFilesParams {
  now: Date;
  listFilesInMonth: (year: string, month: string) => Promise<StoredCensusFile[]>;
}

export type SharedCensusFilesLoadResult = ControllerResult<
  { files: StoredCensusFile[] },
  SharedCensusFilesLoadErrorCode,
  SharedCensusFilesLoadError
>;

export const executeLoadSharedCensusFilesController = async ({
  now,
  listFilesInMonth,
}: ExecuteLoadSharedCensusFilesParams): Promise<SharedCensusFilesLoadResult> => {
  try {
    const { currentYear, currentMonth, previousYear, previousMonth } =
      resolveSharedCensusMonthWindow(now);

    const [currentFiles, previousFiles] = await Promise.all([
      listFilesInMonth(currentYear, currentMonth),
      listFilesInMonth(previousYear, previousMonth),
    ]);

    return ok({
      files: selectLatestSharedCensusFiles({
        currentFiles,
        previousFiles,
      }),
    });
  } catch {
    return failWithCode('LIST_FILES_FAILED', 'No se pudieron cargar los archivos del censo.');
  }
};

export type SharedCensusDownloadPermissionResult = ControllerResult<
  { allowed: true },
  SharedCensusDownloadPermissionErrorCode,
  SharedCensusDownloadPermissionError
>;

export const resolveSharedCensusDownloadPermission = (
  role: 'downloader' | 'viewer' | undefined
): SharedCensusDownloadPermissionResult => {
  if (role !== 'downloader') {
    return failWithCode(
      'DOWNLOAD_PERMISSION_REQUIRED',
      'No tienes permisos de descarga. Contacta al administrador si necesitas el archivo.'
    );
  }

  return ok({ allowed: true });
};
