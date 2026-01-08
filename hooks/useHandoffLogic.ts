/**
 * useHandoffLogic Hook
 * Extracted from HandoffView.tsx for better separation of concerns.
 * Handles handoff state management, note sync, and WhatsApp integration.
 * 
 * ## CRITICAL DESIGN PHILOSOPHY
 * 
 * **Census is the Single Source of Truth for Staff**
 * 
 * The staff lists displayed in the Handoff view (`deliversList`, `receivesList`, `tensList`)
 * are derived DIRECTLY from the Census Daily data:
 * - `nursesDayShift` / `nursesNightShift` → Nurses delivering/receiving
 * - `tensDayShift` / `tensNightShift` → TENS on duty
 * 
 * This design ensures:
 * 1. No synchronization issues between Census and Handoff views
 * 2. Staff changes in Census immediately reflect in Handoff
 * 3. No duplicate data storage that could become inconsistent
 * 
 * **DO NOT** create separate handoff-specific staff lists (e.g., `handoffDayDelivers`).
 * Any such fields should be considered deprecated.
 * 
 * @see useNurseManagement - Manages staff updates in the Census
 * @see useTensManagement - Manages TENS updates in the Census
 */

import { useState, useMemo, useCallback } from 'react';
import { DailyRecord, PatientData } from '@/types';
import { BEDS } from '@/constants';
import { getShiftSchedule, isAdmittedDuringShift } from '@/utils/dateUtils';
import { getWhatsAppConfig, getMessageTemplates } from '@/services/integrations/whatsapp/whatsappService';
import { logNurseHandoffModified, logMedicalHandoffModified } from '@/services/admin/auditService';

export type NursingShift = 'day' | 'night';

interface UseHandoffLogicParams {
    record: DailyRecord | null;
    type: 'nursing' | 'medical';
    selectedShift: NursingShift;
    setSelectedShift: (s: NursingShift) => void;
    updatePatient: (bedId: string, field: keyof PatientData, value: PatientData[keyof PatientData]) => void;
    updatePatientMultiple: (bedId: string, updates: Partial<PatientData>) => void;
    updateClinicalCrib: (bedId: string, field: keyof PatientData, value: PatientData[keyof PatientData]) => void;
    updateClinicalCribMultiple: (bedId: string, updates: Partial<PatientData>) => void;
    sendMedicalHandoff: (template: string, groupId: string) => Promise<void>;
    onSuccess: (message: string, description?: string) => void;
}

export const useHandoffLogic = ({
    record,
    type,
    selectedShift,
    setSelectedShift,
    updatePatient,
    updatePatientMultiple,
    updateClinicalCrib,
    updateClinicalCribMultiple,
    sendMedicalHandoff,
    onSuccess,
}: UseHandoffLogicParams) => {
    // ========== STATE ==========
    const [whatsappSending, setWhatsappSending] = useState(false);
    const [whatsappSent, setWhatsappSent] = useState(false);

    const isMedical = type === 'medical';

    // ========== MEMOS ==========
    // Helper to check if a list is actually empty (void or all empty strings)
    const isActuallyEmpty = (list: string[]) => !list || list.length === 0 || !list.some(name => name && name.trim().length > 0);

    const visibleBeds = useMemo(() => {
        if (!record) return [];
        const activeExtras = record.activeExtraBeds || [];
        return BEDS.filter(bed => !bed.isExtra || activeExtras.includes(bed.id));
    }, [record]);

    /**
     * Helper to determine if a patient in a bed should be visible in the current shift.
     * Uses isAdmittedDuringShift to filter based on admission date/time.
     * 
     * @param bedId - The bed ID to check
     * @returns true if the patient should be shown, false if they should be hidden
     */
    const shouldShowPatient = useCallback((bedId: string): boolean => {
        if (!record) return false;

        const patient = record.beds[bedId];
        if (!patient || !patient.patientName) return false;
        if (patient.isBlocked) return true; // Always show blocked beds

        return isAdmittedDuringShift(
            record.date,
            patient.admissionDate,
            patient.admissionTime,
            selectedShift
        );
    }, [record, selectedShift]);

    const hasAnyPatients = useMemo(() => {
        if (!record) return false;
        return visibleBeds.some(b => {
            const patient = record.beds[b.id];
            if (!patient?.patientName && !patient?.isBlocked) return false;
            if (patient?.isBlocked) return true;
            return shouldShowPatient(b.id);
        });
    }, [visibleBeds, record, shouldShowPatient]);

    const schedule = useMemo(() => {
        if (!record) return { dayStart: '08:00', dayEnd: '20:00', nightStart: '20:00', nightEnd: '08:00', description: '' };
        return getShiftSchedule(record.date);
    }, [record]);

    const noteField = useMemo(() => {
        if (!record || isMedical) return 'medicalHandoffNote' as const;
        return selectedShift === 'day' ? ('handoffNoteDayShift' as const) : ('handoffNoteNightShift' as const);
    }, [record, isMedical, selectedShift]);

    // Staff lists - Use census data directly for display
    // The census is the source of truth for who is working each shift
    const deliversList = useMemo(() => {
        if (!record) return [];
        // Day shift: nurses delivering are the day shift nurses
        // Night shift: nurses delivering are the night shift nurses
        const list = selectedShift === 'day'
            ? (record.nursesDayShift || [])
            : (record.nursesNightShift || []);
        return list;
    }, [record, selectedShift]);

    const receivesList = useMemo(() => {
        if (!record) return [];
        // Day shift: nurses receiving are typically the night shift nurses
        // Night shift: nurses receiving are from the next day, so it should be empty
        const list = selectedShift === 'day'
            ? (record.nursesNightShift || [])
            : (record.handoffNightReceives || []);
        return list;
    }, [record, selectedShift]);

    const tensList = useMemo(() => {
        if (!record) return [];
        const list = selectedShift === 'day' ? (record.tensDayShift || []) : (record.tensNightShift || []);
        return list;
    }, [record, selectedShift]);

    // ========== HANDLERS ==========
    /**
     * Handles changes to nursing or medical notes.
     * Automatically logs modifications to the audit service.
     * 
     * @param bedId - The unique ID of the bed being modified.
     * @param value - The new note content.
     * @param isNested - True if the note belongs to a clinical crib within the bed.
     */
    const handleNursingNoteChange = useCallback(async (bedId: string, value: string, isNested: boolean = false) => {
        const bed = record?.beds[bedId];
        const oldNote = isMedical
            ? (isNested ? bed?.clinicalCrib?.medicalHandoffNote : bed?.medicalHandoffNote)
            : (selectedShift === 'day'
                ? (isNested ? bed?.clinicalCrib?.handoffNoteDayShift : bed?.handoffNoteDayShift)
                : (isNested ? bed?.clinicalCrib?.handoffNoteNightShift : bed?.handoffNoteNightShift));

        if (isMedical) {
            if (isNested) {
                await updateClinicalCrib(bedId, 'medicalHandoffNote', value);
                const p = record?.beds[bedId].clinicalCrib;
                if (p) logMedicalHandoffModified(bedId, p.patientName || 'Cuna', p.rut || '-', value, (oldNote as string) || '', record?.date || '');
            } else {
                updatePatient(bedId, 'medicalHandoffNote', value);
                const p = record?.beds[bedId];
                if (p) logMedicalHandoffModified(bedId, p.patientName || 'ANONYMOUS', p.rut || '-', value, (oldNote as string) || '', record?.date || '');
            }
        } else {
            if (selectedShift === 'day') {
                if (isNested) {
                    updateClinicalCribMultiple(bedId, {
                        handoffNoteDayShift: value,
                        handoffNoteNightShift: value
                    });
                    const p = record?.beds[bedId].clinicalCrib;
                    if (p) logNurseHandoffModified(bedId, p.patientName || 'Cuna', p.rut || '-', 'day', value, (oldNote as string) || '', record?.date || '');
                } else {
                    updatePatientMultiple(bedId, {
                        handoffNoteDayShift: value,
                        handoffNoteNightShift: value
                    });
                    const p = record?.beds[bedId];
                    if (p) logNurseHandoffModified(bedId, p.patientName || 'ANONYMOUS', p.rut || '-', 'day', value, (oldNote as string) || '', record?.date || '');
                }
            } else {
                if (isNested) {
                    updateClinicalCrib(bedId, 'handoffNoteNightShift', value);
                    const p = record?.beds[bedId].clinicalCrib;
                    if (p) logNurseHandoffModified(bedId, p.patientName || 'Cuna', p.rut || '-', 'night', value, (oldNote as string) || '', record?.date || '');
                } else {
                    updatePatient(bedId, 'handoffNoteNightShift', value);
                    const p = record?.beds[bedId];
                    if (p) logNurseHandoffModified(bedId, p.patientName || 'ANONYMOUS', p.rut || '-', 'night', value, (oldNote as string) || '', record?.date || '');
                }
            }
        }
    }, [isMedical, selectedShift, record, updatePatient, updatePatientMultiple, updateClinicalCrib, updateClinicalCribMultiple]);

    /**
     * Copies the unique signature link to the system clipboard.
     */
    const handleShareLink = useCallback(() => {
        if (!record) return;
        const url = `${window.location.origin}?mode=signature&date=${record.date}`;
        navigator.clipboard.writeText(url);
        onSuccess('Enlace copiado', 'El link para firma médica ha sido copiado al portapapeles.');
    }, [record, onSuccess]);

    /**
     * Sends the medical handoff summary to the configured WhatsApp group via integration service.
     */
    const handleSendWhatsApp = useCallback(async () => {
        if (!record) return;
        setWhatsappSending(true);
        try {
            const config = await getWhatsAppConfig();
            const templates = await getMessageTemplates();

            if (!config || !config.handoffNotifications?.targetGroupId) {
                throw new Error('WhatsApp no configurado. Configure el grupo destino en ajustes.');
            }

            const handoffTemplate = templates.find(t => t.type === 'handoff');
            if (!handoffTemplate) {
                throw new Error('No se encontró template de entrega médica');
            }

            await sendMedicalHandoff(handoffTemplate.content, config.handoffNotifications.targetGroupId);
            setWhatsappSent(true);
            onSuccess('Entrega enviada a WhatsApp correctamente');
        } catch (error: unknown) {
            const err = error as Error;
            console.error('Error sending WhatsApp:', err);
            onSuccess(err.message || 'Error al enviar a WhatsApp');
        } finally {
            setWhatsappSending(false);
        }
    }, [record, sendMedicalHandoff, onSuccess]);

    /**
     * Opens the WhatsApp web/app interface with a pre-filled message for manual sharing.
     */
    const handleSendWhatsAppManual = useCallback(async () => {
        if (!record) return;
        try {
            const templates = await getMessageTemplates();
            const handoffTemplate = templates.find(t => t.type === 'handoff');
            if (!handoffTemplate) {
                throw new Error('No se encontró template de entrega médica');
            }

            // Calculate Stats (Replica of server-side logic for consistency)
            const hospitalized = visibleBeds.filter(b => {
                const p = record.beds[b.id];
                return p && p.patientName && !p.isBlocked;
            }).length;

            const blockedBeds = visibleBeds.filter(b => record.beds[b.id]?.isBlocked).length;
            const freeBeds = visibleBeds.length - hospitalized - blockedBeds;

            const [year, month, day] = record.date.split('-');
            const dateStr = `${day}-${month}-${year}`;
            const handoffUrl = `${window.location.origin}?mode=signature&date=${dateStr}`;

            // Manual message construction with legacy surrogate pairs for maximum cross-platform compatibility
            const message = `\uD83C\uDFE5 Hospital Hanga Roa\n` +
                `\uD83D\uDCCB Entrega de Turno M\u00E9dico\n\n` +
                `\uD83D\uDCC5 Fecha: ${dateStr}\n` +
                `\uD83D\uDC68\u200D\u2695\uFE0F Entregado por: ${record.medicalHandoffDoctor || 'Sin especificar'}\n` +
                `\uD83D\uDD51 Firmado: ${new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}\n\n` +
                `\uD83D\uDCCA Resumen:\n` +
                `\u2022 Hospitalizados: ${hospitalized} pacientes\n` +
                `\u2022 Camas libres: ${freeBeds}\n` +
                `\u2022 Nuevos ingresos: 0\n` +
                `\u2022 Altas: 0\n\n` +
                `\uD83D\uDD17 Ver entrega completa:\n` +
                `${handoffUrl}\n\n` +
                `- Enviado manualmente por Sistema HHR`;

            const encodedMessage = encodeURIComponent(message);
            window.open(`https://api.whatsapp.com/send?text=${encodedMessage}`, '_blank');
        } catch (error: unknown) {
            const err = error as Error;
            console.error('Error in manual WhatsApp:', err);
            onSuccess(err.message || 'Error al preparar WhatsApp');
        }
    }, [record, visibleBeds, onSuccess]);

    // ========== FORMATTING ==========
    const formatPrintDate = useCallback(() => {
        if (!record) return '';
        const [year, month, day] = record.date.split('-');
        return `${day}-${month}-${year}`;
    }, [record]);

    return {
        // State
        selectedShift,
        setSelectedShift,
        whatsappSending,
        whatsappSent,

        // Computed
        isMedical,
        visibleBeds,
        hasAnyPatients,
        schedule,
        noteField,
        deliversList,
        receivesList,
        tensList,

        // Shift filtering
        shouldShowPatient,

        // Handlers
        handleNursingNoteChange,
        handleShareLink,
        handleSendWhatsApp,
        handleSendWhatsAppManual,
        formatPrintDate,
    };
};
