import React from 'react';
import * as ExportService from '../services/exporters/exportService';
import { DailyRecord } from '../types';
import { useNotification } from '../context/UIContext';

export interface UseFileOperationsReturn {
    handleExportJSON: () => void;
    handleExportCSV: () => void;
    handleImportJSON: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
}

/**
 * Hook to manage file import/export operations
 * Extracts file handling logic from App.tsx for cleaner separation of concerns
 */
export const useFileOperations = (
    record: DailyRecord | null,
    onRefresh: () => void
): UseFileOperationsReturn => {
    const { success, error } = useNotification();

    const handleExportJSON = () => {
        try {
            ExportService.exportDataJSON();
            success('Datos exportados exitosamente', 'Export JSON');
        } catch (_err) {
            error('Error al exportar datos', 'Export Error');
        }
    };

    const handleExportCSV = () => {
        try {
            ExportService.exportDataCSV(record);
            success('CSV exportado exitosamente', 'Export CSV');
        } catch (_err) {
            error('Error al exportar CSV', 'Export Error');
        }
    };

    const handleImportJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];

            if (file.name.endsWith('.json')) {
                try {
                    const importSuccess = await ExportService.importDataJSON(file);
                    if (importSuccess) {
                        success('Datos importados correctamente', 'Import');
                        onRefresh();
                    } else {
                        error('Error al importar datos', 'Import Error');
                    }
                } catch (_err) {
                    error('Error al procesar archivo', 'Import Error');
                }
            } else {
                error('Por favor seleccione un archivo .json válido', 'Formato Inválido');
            }

            // Reset input
            e.target.value = '';
        }
    };

    return {
        handleExportJSON,
        handleExportCSV,
        handleImportJSON
    };
};
