import { useState, useEffect, useCallback } from 'react';
import { DailyRecord } from '@/types';
import { checkCensusExists, uploadCensus } from '@/services/backup/censusStorageService';
import { getMonthRecordsFromFirestore } from '@/services';
import { buildCensusMasterWorkbook } from '@/services/exporters/censusMasterWorkbook';
import { useConfirmDialog, useNotification } from '@/context/UIContext';

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
    isBackingUp: boolean;
    handleExportPDF: () => Promise<void>;
    handleBackupExcel: () => Promise<void>;
    handleBackupHandoff: (skipConfirmation?: boolean) => Promise<void>;
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
    const { confirm } = useConfirmDialog();

    // Track if current date's census or handoff is already archived
    const [isArchived, setIsArchived] = useState(false);
    const [isBackingUp, setIsBackingUp] = useState(false);

    // Check archive status when date/module changes
    useEffect(() => {
        if (currentDateString) {
            if (currentModule === 'CENSUS') {
                checkCensusExists(currentDateString)
                    .then(exists => setIsArchived(exists))
                    .catch(() => setIsArchived(false));
            } else if (currentModule === 'NURSING_HANDOFF') {
                import('@/services/backup/pdfStorageService').then(({ pdfExists }) => {
                    pdfExists(currentDateString, selectedShift)
                        .then(exists => setIsArchived(exists))
                        .catch(() => setIsArchived(false));
                });
            }
        }
    }, [currentDateString, currentModule, selectedShift]);

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
        setIsBackingUp(true);
        try {
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
        } catch (err) {
            console.error('Error in backup:', err);
            notifyError('Error al realizar el respaldo en la nube');
        } finally {
            setIsBackingUp(false);
        }
    }, [selectedYear, selectedMonth, selectedDay, record, currentDateString, success, warning, notifyError]);

    const handleBackupHandoff = useCallback(async (skipConfirmation = false) => {
        if (!record) return;

        // Staff derive logic
        const delivers = selectedShift === 'day' ? (record.nursesDayShift || []) : (record.nursesNightShift || []);
        const receives = selectedShift === 'day' ? (record.nursesNightShift || []) : (record.handoffNightReceives || []);

        if (delivers.length === 0 || receives.length === 0) {
            warning('Selecciona enfermera que entrega y recibe antes de guardar');
            return;
        }

        // Validate critical fields
        const { validateCriticalFields, getMissingFieldsLabel } = await import('@/services/validation/criticalFieldsValidator');
        const validation = validateCriticalFields(record);
        if (!validation.isValid) {
            const firstIssue = validation.issues[0];
            const fieldsMessage = getMissingFieldsLabel(firstIssue.missingFields);
            warning(
                `Campos críticos incompletos`,
                `${validation.issueCount} paciente(s) sin ${fieldsMessage}. Complete los datos antes de guardar.`
            );
            return;
        }

        const [year, month, day] = record.date.split('-');
        const formattedDate = `${day}-${month}-${year}`;
        const shiftLabel = selectedShift === 'day' ? 'Turno Largo' : 'Turno Noche';
        const actionLabel = isArchived ? 'Actualizar' : 'Guardar';

        if (!skipConfirmation) {
            const confirmed = await confirm({
                title: `💾 ${actionLabel} Respaldo PDF`,
                message: isArchived
                    ? `Ya existe un respaldo para ${shiftLabel} del ${formattedDate}.\n\n¿Desea sobrescribirlo con los datos actuales?`
                    : `¿Desea guardar esta entrega de turno como archivo PDF?\n\nFecha: ${formattedDate}\nTurno: ${shiftLabel}`,
                confirmText: actionLabel,
                cancelText: 'Cancelar',
                variant: isArchived ? 'warning' : 'info'
            });

            if (!confirmed) return;
        }

        setIsBackingUp(true);
        try {
            const [{ default: jsPDF }, { default: autoTable }, { buildHandoffPdfContent }, { uploadPdf }] = await Promise.all([
                import('jspdf'),
                import('jspdf-autotable'),
                import('@/services/backup/pdfContentBuilder'),
                import('@/services/backup/pdfStorageService')
            ]);

            const [{ getShiftSchedule }] = await Promise.all([import('@/utils/dateUtils')]);
            const schedule = getShiftSchedule(record.date);

            const doc = new jsPDF();
            await buildHandoffPdfContent(doc, record, selectedShift, schedule, autoTable);
            const pdfBlob = doc.output('blob');
            await uploadPdf(pdfBlob, record.date, selectedShift);

            if (selectedShift === 'night') {
                try {
                    const { generateCudyrMonthlyExcelBlob } = await import('@/features/cudyr/services/cudyrExportService');
                    const { uploadCudyrExcel } = await import('@/features/cudyr/services/cudyrStorageService');
                    const [year, month] = record.date.split('-').map(Number);
                    const cudyrBlob = await generateCudyrMonthlyExcelBlob(year, month, record.date, record);
                    await uploadCudyrExcel(cudyrBlob, record.date);
                    success('Respaldos guardados', 'PDF + CUDYR mensual');
                } catch (cudyrErr) {
                    console.error('CUDYR backup failed:', cudyrErr);
                    warning('PDF guardado, CUDYR falló');
                }
            } else {
                success('Respaldo PDF guardado');
            }
            setIsArchived(true);
        } catch (err) {
            console.error('Error saving handoff PDF:', err);
            notifyError('Error al guardar el respaldo PDF');
        } finally {
            setIsBackingUp(false);
        }
    }, [record, selectedShift, success, warning, notifyError, confirm, isArchived]);

    return {
        isArchived,
        isBackingUp,
        handleExportPDF,
        handleBackupExcel,
        handleBackupHandoff
    };
};
