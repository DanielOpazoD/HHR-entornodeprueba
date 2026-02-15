import { useState, useEffect, useCallback } from 'react';
import { listCensusFilesInMonth, StoredCensusFile } from '@/services/backup/censusStorageService';
import { logAccess } from '@/services/census/censusAccessService';
import { CensusAccessUser } from '@/types/censusAccess';
import {
    filterSharedCensusFilesByTerm,
    resolveSharedCensusMonthWindow,
    selectLatestSharedCensusFiles
} from '@/features/census/controllers/sharedCensusFilesController';

export const useSharedCensusFiles = (accessUser: CensusAccessUser | null) => {
    const [files, setFiles] = useState<StoredCensusFile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedFile, setSelectedFile] = useState<StoredCensusFile | null>(null);

    const fetchFiles = useCallback(async () => {
        if (!accessUser) return;
        setIsLoading(true);
        try {
            const {
                currentYear,
                currentMonth,
                previousYear,
                previousMonth
            } = resolveSharedCensusMonthWindow(new Date());

            const [currentFiles, prevFiles] = await Promise.all([
                listCensusFilesInMonth(currentYear, currentMonth),
                listCensusFilesInMonth(previousYear, previousMonth)
            ]);

            setFiles(selectLatestSharedCensusFiles({
                currentFiles,
                previousFiles: prevFiles
            }));

            logAccess({
                userId: accessUser.id,
                email: accessUser.email,
                action: 'list_files'
            });

        } catch (err: unknown) {
            console.error('[SharedCensusView] Error fetching files:', err);
            setLoadError('No se pudieron cargar los archivos del censo.');
        } finally {
            setIsLoading(false);
        }
    }, [accessUser]);

    useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    const handleDownload = useCallback(async (file: StoredCensusFile) => {
        if (!accessUser) return;
        if (accessUser.role !== 'downloader') {
            alert('No tienes permisos de descarga. Contacta al administrador si necesitas el archivo.');
            return;
        }

        try {
            logAccess({
                userId: accessUser.id,
                email: accessUser.email,
                action: 'download_file',
                filePath: file.fullPath,
                fileName: file.name
            });

            window.open(file.downloadUrl, '_blank');
        } catch (err) {
            console.error('Download error:', err);
            alert('Error al intentar descargar el archivo.');
        }
    }, [accessUser]);

    const handleViewFile = useCallback((file: StoredCensusFile) => {
        if (!accessUser) return;
        logAccess({
            userId: accessUser.id,
            email: accessUser.email,
            action: 'view_file',
            filePath: file.fullPath,
            fileName: file.name
        });

        setSelectedFile(file);
    }, [accessUser]);

    const filteredFiles = filterSharedCensusFilesByTerm(files, searchTerm);

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
            refresh: fetchFiles
        }
    };
};
