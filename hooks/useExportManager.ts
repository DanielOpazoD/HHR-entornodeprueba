import { useState, useEffect, useCallback } from 'react';
import { DailyRecord } from '@/types';
import { checkCensusExists, uploadCensus } from '@/services/backup/censusStorageService';
import { getMonthRecordsFromFirestore } from '@/services';
import { buildCensusMasterWorkbook } from '@/services/exporters/censusMasterWorkbook';
import { useNotification } from '@/context/UIContext';

interface UseExportManagerProps {
    currentDateString: string;
    selectedYear: number;
    selectedMonth: number;
    selectedDay: number;
    record: DailyRecord | null;
    currentModule: string;
    selectedShift: 'day' | 'night';
}

export interface UseExportManagerReturn {
    isArchived: boolean;
    handleExportPDF: () => Promise<void>;
    handleBackupExcel: () => Promise<void>;
}

export const useExportManager = ({
    currentDateString,
    selectedYear,
    selectedMonth,
    selectedDay,
    record,
    currentModule,
    selectedShift
}: UseExportManagerProps): UseExportManagerReturn => {
    const { success, error: notifyError, warning } = useNotification();
    // Track if current date's census is already archived
    const [isArchived, setIsArchived] = useState(false);

    // Check archive status when date changes
    useEffect(() => {
        if (currentDateString && currentModule === 'CENSUS') {
            checkCensusExists(currentDateString)
                .then(exists => setIsArchived(exists))
                .catch(() => setIsArchived(false));
        }
    }, [currentDateString, currentModule]);

    const handleExportPDF = useCallback(async () => {
        try {
            // Import dynamically to avoid loading jsPDF on main bundle if possible
            const { generateHandoffPdf } = await import('@/services/pdf/handoffPdfGenerator');
            if (record) {
                await generateHandoffPdf(record, false, selectedShift, { dayStart: '08:00', dayEnd: '20:00', nightStart: '20:00', nightEnd: '08:00' });
            }
        } catch (error) {
            console.error('Error generating PDF:', error);
            notifyError('Error al generar el PDF. Por favor intente nuevamente.');
        }
    }, [record, selectedShift, notifyError]);

    const handleBackupExcel = useCallback(async () => {
        // Build Excel and upload to Firebase Storage
        const monthRecords = await getMonthRecordsFromFirestore(selectedYear, selectedMonth);
        const limitDate = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;

        const filteredRecords = monthRecords
            .filter(r => r.date <= limitDate)
            .sort((a, b) => a.date.localeCompare(b.date));

        // Include current record if not in the list
        if (record && !filteredRecords.some(r => r.date === currentDateString)) {
            filteredRecords.push(record);
            filteredRecords.sort((a, b) => a.date.localeCompare(b.date));
        }

        if (filteredRecords.length === 0) {
            warning('No hay registros para archivar.');
            return;
        }

        const workbook = await buildCensusMasterWorkbook(filteredRecords);
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        });

        await uploadCensus(blob, currentDateString);
        setIsArchived(true);
        success('Excel archivado', `Guardado para ${currentDateString}`);
    }, [selectedYear, selectedMonth, selectedDay, record, currentDateString, success, warning]);

    return {
        isArchived,
        handleExportPDF,
        handleBackupExcel
    };
};
