import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { StoredCensusFile } from '@/types/backupArtifacts';
import { CensusAccessUser } from '@/types/censusAccess';
import {
  filterSharedCensusFilesByTerm,
  resolveSharedCensusDownloadPermission,
} from '@/hooks/controllers/sharedCensusFilesController';
import {
  defaultSharedCensusBrowserRuntime,
  SharedCensusBrowserRuntime,
} from '@/hooks/controllers/sharedCensusBrowserRuntimeController';
import {
  executeLoadSharedCensusFiles,
  executeLogSharedCensusAccess,
} from '@/application/backup-export/sharedCensusFilesUseCases';
import { resolveApplicationOutcomeMessage } from '@/shared/contracts/applicationOutcomeMessage';
import { logger } from '@/services/utils/loggerService';

const sharedCensusFilesLogger = logger.child('useSharedCensusFiles');

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

  const safeLogAccess = useCallback(
    (params: Parameters<typeof executeLogSharedCensusAccess>[0]) => {
      void Promise.resolve(executeLogSharedCensusAccess(params)).catch(error => {
        sharedCensusFilesLogger.error('Failed to log shared census access', error);
      });
    },
    []
  );

  const fetchFiles = useCallback(async () => {
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;

    if (!accessUser) {
      if (mountedRef.current) {
        setFiles([]);
        setLoadError(null);
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    try {
      const outcome = await executeLoadSharedCensusFiles(new Date());

      if (!mountedRef.current || requestSequence !== requestSequenceRef.current) {
        return;
      }

      setFiles(outcome.data ?? []);
      if (outcome.status === 'failed') {
        setLoadError(
          resolveApplicationOutcomeMessage(outcome, 'No se pudieron cargar los archivos del censo.')
        );
        return;
      }
      setLoadError(null);

      safeLogAccess({
        userId: accessUser.id,
        email: accessUser.email,
        action: 'list_files',
      });
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
        sharedCensusFilesLogger.error('Failed to download shared census file', err);
        runtime.alert('Error al intentar descargar el archivo.');
      }
    },
    [accessUser, runtime, safeLogAccess]
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
