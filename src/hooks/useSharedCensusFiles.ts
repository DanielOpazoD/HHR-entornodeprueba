import { useState, useEffect, useCallback } from 'react';
import { listCensusFilesInMonth, StoredCensusFile } from '@/services/backup/censusStorageService';
import { logAccess } from '@/services/census/censusAccessService';
import { CensusAccessUser } from '@/types/censusAccess';

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
            const now = new Date();
            const currentMonth = now.getMonth();
            const currentYear = now.getFullYear();

            let prevMonth = currentMonth - 1;
            let prevYear = currentYear;
            if (prevMonth < 0) {
                prevMonth = 11;
                prevYear--;
            }

            const currentMonthNum = String(currentMonth + 1).padStart(2, '0');
            const prevMonthNum = String(prevMonth + 1).padStart(2, '0');

            const [currentFiles, prevFiles] = await Promise.all([
                listCensusFilesInMonth(currentYear.toString(), currentMonthNum),
                listCensusFilesInMonth(prevYear.toString(), prevMonthNum)
            ]);

            const selectedFiles: StoredCensusFile[] = [];

            if (currentFiles.length > 0) {
                const sortedCurrent = [...currentFiles].sort((a, b) => b.date.localeCompare(a.date));
                selectedFiles.push(sortedCurrent[0]);
            }

            if (prevFiles.length > 0) {
                const sortedPrev = [...prevFiles].sort((a, b) => b.date.localeCompare(a.date));
                selectedFiles.push(sortedPrev[0]);
            }

            setFiles(selectedFiles);

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

    const filteredFiles = files.filter(f =>
        f.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        f.date.includes(searchTerm)
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
            refresh: fetchFiles
        }
    };
};
