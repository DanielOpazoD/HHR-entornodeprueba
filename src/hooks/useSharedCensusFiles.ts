import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { listCensusFilesInMonth, StoredCensusFile } from '@/services/backup/censusStorageService';
import { logAccess } from '@/services/census/censusAccessService';
import { CensusAccessUser } from '@/types/censusAccess';
import {
  executeLoadSharedCensusFilesController,
  filterSharedCensusFilesByTerm,
  resolveSharedCensusDownloadPermission,
} from '@/features/census/controllers/sharedCensusFilesController';
import {
  defaultSharedCensusBrowserRuntime,
  SharedCensusBrowserRuntime,
} from '@/features/census/controllers/sharedCensusBrowserRuntimeController';

export const useSharedCensusFiles = (
  accessUser: CensusAccessUser | null,
  runtime: SharedCensusBrowserRuntime = defaultSharedCensusBrowserRuntime
) => {
  const [files, setFiles] = useState<StoredCensusFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFile, setSelectedFile] = useState<StoredCensusFile | null>(null);
  const requestSequenceRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeLogAccess = useCallback((params: Parameters<typeof logAccess>[0]) => {
    void Promise.resolve(logAccess(params)).catch(error => {
      console.error('[SharedCensusFiles] Failed to log access:', error);
    });
  }, []);

  const fetchFiles = useCallback(async () => {
    if (!accessUser) {
      if (mountedRef.current) {
        setFiles([]);
        setLoadError(null);
        setIsLoading(false);
      }
      return;
    }

    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;

    setIsLoading(true);
    try {
      const result = await executeLoadSharedCensusFilesController({
        now: new Date(),
        listFilesInMonth: listCensusFilesInMonth,
      });

      if (!mountedRef.current || requestSequence !== requestSequenceRef.current) {
        return;
      }

      if (!result.ok) {
        setLoadError(result.error.message);
        return;
      }

      setFiles(result.value.files);
      setLoadError(null);

      safeLogAccess({
        userId: accessUser.id,
        email: accessUser.email,
        action: 'list_files',
      });
    } catch (err: unknown) {
      if (!mountedRef.current || requestSequence !== requestSequenceRef.current) {
        return;
      }

      console.error('[SharedCensusView] Error fetching files:', err);
      setLoadError('No se pudieron cargar los archivos del censo.');
    } finally {
      if (mountedRef.current && requestSequence === requestSequenceRef.current) {
        setIsLoading(false);
      }
    }
  }, [accessUser, safeLogAccess]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleDownload = useCallback(
    async (file: StoredCensusFile) => {
      if (!accessUser) return;
      const permission = resolveSharedCensusDownloadPermission(accessUser.role);
      if (!permission.ok) {
        runtime.alert(permission.error.message);
        return;
      }

      try {
        safeLogAccess({
          userId: accessUser.id,
          email: accessUser.email,
          action: 'download_file',
          filePath: file.fullPath,
          fileName: file.name,
        });

        runtime.open(file.downloadUrl, '_blank');
      } catch (err) {
        console.error('Download error:', err);
        runtime.alert('Error al intentar descargar el archivo.');
      }
    },
    [accessUser, runtime]
  );

  const handleViewFile = useCallback(
    (file: StoredCensusFile) => {
      if (!accessUser) return;
      safeLogAccess({
        userId: accessUser.id,
        email: accessUser.email,
        action: 'view_file',
        filePath: file.fullPath,
        fileName: file.name,
      });

      setSelectedFile(file);
    },
    [accessUser, safeLogAccess]
  );

  const filteredFiles = useMemo(
    () => filterSharedCensusFilesByTerm(files, searchTerm),
    [files, searchTerm]
  );

  return {
    files,
    filteredFiles,
    isLoading,
    loadError,
    searchTerm,
    setSearchTerm,
    selectedFile,
    setSelectedFile,
    handlers: {
      handleDownload,
      handleViewFile,
      refresh: fetchFiles,
    },
  };
};
