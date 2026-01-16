/**
 * Save Backup Button Component
 * Button to save the current handoff as a PDF in Firebase Storage
 * 
 * Features:
 * - Generates PDF using the same format as PDF LITE
 * - Uploads to Storage with folder structure: year/month/file.pdf
 * - Shows different state if backup already exists for this day+shift
 * - Allows re-saving (overwrites existing)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Save, CheckCircle, Loader2 } from 'lucide-react';
import { useConfirmDialog, useNotification } from '../../context/UIContext';
import { uploadPdf, pdfExists } from '../../services/backup/pdfStorageService';
import { validateCriticalFields, getMissingFieldsLabel } from '../../services/validation/criticalFieldsValidator';
import { uploadCudyrExcel } from '../../services/backup/cudyrStorageService';
import { DailyRecord } from '../../types';

interface SaveBackupButtonProps {
    date: string;
    shiftType: 'day' | 'night';
    deliveryStaff: string;
    receivingStaff: string;
    record: DailyRecord;
    schedule: any;
    disabled?: boolean;
}

export const SaveBackupButton: React.FC<SaveBackupButtonProps> = ({
    date,
    shiftType,
    deliveryStaff,
    receivingStaff,
    record,
    schedule,
    disabled = false
}) => {
    const { confirm } = useConfirmDialog();
    const { success, warning, error } = useNotification();

    const [backupExists, setBackupExists] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [justSaved, setJustSaved] = useState(false);
    const [isChecking, setIsChecking] = useState(true);

    // Check if backup exists on mount and when date/shift changes
    useEffect(() => {
        const check = async () => {
            console.log(`[SaveBackupButton] 🔍 Init check for ${date} ${shiftType}`);
            setIsChecking(true);
            try {
                const exists = await pdfExists(date, shiftType);
                setBackupExists(exists);
            } catch (err) {
                console.error('[SaveBackupButton] ❌ Error checking backup:', err);
                setBackupExists(false); // Default to false if error to let user try saving
            } finally {
                console.log(`[SaveBackupButton] 🏁 Check finished for ${date} ${shiftType}`);
                setIsChecking(false);
            }
        };
        check();
    }, [date, shiftType]);

    const handleSave = useCallback(async () => {
        // Validate required fields
        if (!deliveryStaff || !receivingStaff) {
            warning('Selecciona enfermera que entrega y recibe antes de guardar');
            return;
        }

        // Validate critical fields (Estado, Fecha de ingreso)
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

        const [year, month, day] = date.split('-');
        const formattedDate = `${day}-${month}-${year}`;
        const shiftLabel = shiftType === 'day' ? 'Turno Largo' : 'Turno Noche';
        const actionLabel = backupExists ? 'Actualizar' : 'Guardar';

        const confirmed = await confirm({
            title: `💾 ${actionLabel} Respaldo PDF`,
            message: backupExists
                ? `Ya existe un respaldo para ${shiftLabel} del ${formattedDate}.\n\n¿Desea sobrescribirlo con los datos actuales?`
                : `¿Desea guardar esta entrega de turno como archivo PDF?\n\nFecha: ${formattedDate}\nTurno: ${shiftLabel}\nEntrega: ${deliveryStaff}\nRecibe: ${receivingStaff}`,
            confirmText: actionLabel,
            cancelText: 'Cancelar',
            variant: backupExists ? 'warning' : 'info'
        });

        if (!confirmed) return;

        setIsSaving(true);

        try {
            // Dynamically import jsPDF and the PDF builder
            const [{ default: jsPDF }, { default: autoTable }, { buildHandoffPdfContent }] = await Promise.all([
                import('jspdf'),
                import('jspdf-autotable'),
                import('../../services/backup/pdfContentBuilder')
            ]);

            // Create PDF document
            const doc = new jsPDF();

            // Build the PDF content (same as PDF LITE)
            await buildHandoffPdfContent(doc, record, shiftType, schedule, autoTable);

            // Get blob from jsPDF
            const pdfBlob = doc.output('blob');

            // Upload to Storage
            await uploadPdf(pdfBlob, date, shiftType);

            // If night shift, also backup CUDYR monthly Excel
            if (shiftType === 'night') {
                try {
                    console.log('[SaveBackupButton] 📊 Generating CUDYR backup...');
                    const { generateCudyrMonthlyExcelBlob } = await import('../../services/exporters/cudyrExportService');
                    const [year, month] = date.split('-').map(Number);
                    // Pass current record to ensure we use the latest in-memory data instead of potentially stale Firestore data
                    const cudyrBlob = await generateCudyrMonthlyExcelBlob(year, month, date, record);
                    await uploadCudyrExcel(cudyrBlob, date);
                    console.log('[SaveBackupButton] ✅ CUDYR backup uploaded');
                    success('Respaldos guardados', 'PDF + CUDYR mensual');
                } catch (cudyrErr) {
                    console.error('[SaveBackupButton] ⚠️ CUDYR backup failed:', cudyrErr);
                    warning('PDF guardado, CUDYR falló', 'Revise consola para detalles');
                }
            } else {
                success(backupExists ? 'Respaldo PDF actualizado' : 'Respaldo PDF guardado');
            }
            setBackupExists(true);
            setJustSaved(true);
            setTimeout(() => setJustSaved(false), 3000);
        } catch (err) {
            console.error('Error saving PDF backup:', err);
            error('Error al guardar el respaldo PDF');
        } finally {
            setIsSaving(false);
        }
    }, [date, shiftType, deliveryStaff, receivingStaff, record, schedule, backupExists, confirm, success, warning, error]);

    // Determine button appearance (matching census archive button style)
    const getButtonState = () => {
        if (isChecking) {
            return {
                icon: <Loader2 size={14} className="animate-spin" />,
                text: '...',
                className: 'bg-slate-100 text-slate-400 border-slate-200'
            };
        }
        if (isSaving) {
            return {
                icon: <Loader2 size={14} className="animate-spin" />,
                text: 'Guardando...',
                className: 'bg-amber-500 text-white border-amber-500'
            };
        }
        if (justSaved || backupExists) {
            return {
                icon: <CheckCircle size={14} />,
                text: 'Guardado ✓',
                className: 'bg-emerald-600 hover:bg-amber-500 text-white border-emerald-600 hover:border-amber-500'
            };
        }
        return {
            icon: <Save size={14} />,
            text: 'Guardar',
            className: 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500'
        };
    };

    const buttonState = getButtonState();

    return (
        <button
            onClick={handleSave}
            disabled={disabled || isSaving || isChecking}
            className={`
                flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-lg transition-all whitespace-nowrap border-2
                ${buttonState.className}
                disabled:opacity-50 disabled:cursor-not-allowed
            `}
            title={backupExists ? 'Actualizar respaldo existente' : 'Guardar como archivo PDF de respaldo'}
        >
            {buttonState.icon}
            {buttonState.text}
        </button>
    );
};
