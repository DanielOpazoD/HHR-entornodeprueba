/**
 * useBackupFiles Hook
 * Manages backup files state and operations
 */

import { useState, useCallback, useEffect } from 'react';
import {
    listBackupFiles,
    getBackupFile,
    deleteBackupFile,
    saveNursingHandoffBackup,
    checkBackupExists
} from '../services/backup/backupService';
import {
    BackupFile,
    BackupFilePreview,
    BackupFilters,
    BackupShiftType
} from '../types/backup';

interface UseBackupFilesReturn {
    // State
    files: BackupFilePreview[];
    selectedFile: BackupFile | null;
    isLoading: boolean;
    isSaving: boolean;
    error: string | null;
    filters: BackupFilters;

    // Actions
    loadFiles: (filters?: BackupFilters) => Promise<void>;
    loadFile: (id: string) => Promise<void>;
    removeFile: (id: string) => Promise<boolean>;
    setFilters: (filters: BackupFilters) => void;
    clearSelectedFile: () => void;

    // Create/update actions
    saveNursingHandoff: (
        date: string,
        shiftType: BackupShiftType,
        deliveryStaff: string,
        receivingStaff: string,
        content: Record<string, unknown>
    ) => Promise<string | null>;

    // Check if backup exists
    checkExists: (date: string, shiftType: BackupShiftType) => Promise<boolean>;
}

export const useBackupFiles = (): UseBackupFilesReturn => {
    const [files, setFiles] = useState<BackupFilePreview[]>([]);
    const [selectedFile, setSelectedFile] = useState<BackupFile | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filters, setFilters] = useState<BackupFilters>({});

    // Load files list
    const loadFiles = useCallback(async (newFilters?: BackupFilters) => {
        setIsLoading(true);
        setError(null);

        try {
            const appliedFilters = newFilters || filters;
            const result = await listBackupFiles(appliedFilters);
            setFiles(result);

            if (newFilters) {
                setFilters(newFilters);
            }
        } catch (err) {
            console.error('Error loading backup files:', err);
            setError('Error al cargar los archivos de respaldo');
        } finally {
            setIsLoading(false);
        }
    }, [filters]);

    // Load single file with content
    const loadFile = useCallback(async (id: string) => {
        setIsLoading(true);
        setError(null);

        try {
            const file = await getBackupFile(id);
            if (file) {
                setSelectedFile(file);
            } else {
                setError('Archivo no encontrado');
            }
        } catch (err) {
            console.error('Error loading backup file:', err);
            setError('Error al cargar el archivo');
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Delete file
    const removeFile = useCallback(async (id: string): Promise<boolean> => {
        try {
            await deleteBackupFile(id);
            setFiles(prev => prev.filter(f => f.id !== id));
            return true;
        } catch (err) {
            console.error('Error deleting backup file:', err);
            setError('Error al eliminar el archivo');
            return false;
        }
    }, []);

    // Clear selected file
    const clearSelectedFile = useCallback(() => {
        setSelectedFile(null);
    }, []);

    // Save nursing handoff backup (creates or updates)
    const saveNursingHandoff = useCallback(async (
        date: string,
        shiftType: BackupShiftType,
        deliveryStaff: string,
        receivingStaff: string,
        content: Record<string, unknown>
    ): Promise<string | null> => {
        setIsSaving(true);
        setError(null);

        try {
            const id = await saveNursingHandoffBackup(
                date,
                shiftType,
                deliveryStaff,
                receivingStaff,
                content
            );

            // Reload files to reflect changes
            await loadFiles();

            return id;
        } catch (err) {
            console.error('Error creating backup:', err);
            setError('Error al crear el respaldo');
            return null;
        } finally {
            setIsSaving(false);
        }
    }, [loadFiles]);

    // Check if backup exists for date+shift
    const checkExists = useCallback(async (date: string, shiftType: BackupShiftType): Promise<boolean> => {
        try {
            return await checkBackupExists(date, shiftType);
        } catch (err) {
            console.error('Error checking backup:', err);
            return false;
        }
    }, []);

    // Initial load
    useEffect(() => {
        loadFiles();
    }, [loadFiles]);

    return {
        files,
        selectedFile,
        isLoading,
        isSaving,
        error,
        filters,
        loadFiles,
        loadFile,
        removeFile,
        setFilters,
        clearSelectedFile,
        saveNursingHandoff,
        checkExists
    };
};
