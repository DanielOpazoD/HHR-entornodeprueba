/**
 * useHandoffManagement Hook
 * Manages nursing handoff checklists, novedades, and staff identification.
 */

import { useCallback } from 'react';
import { DailyRecord, DailyRecordPatch } from '../types';
import { BEDS } from '../constants';
import { useNotification } from '../context/UIContext';
import { getPreviousDay } from '../services/repositories/DailyRecordRepository';
import { formatHandoffMessage, sendWhatsAppMessage } from '../services/integrations/whatsapp/whatsappService';
import { useAuditContext } from '../context/AuditContext';
import { getAttributedAuthors } from '../services/admin/attributionService';

export interface HandoffManagementActions {
    updateHandoffChecklist: (shift: 'day' | 'night', field: string, value: boolean | string) => void;
    updateHandoffNovedades: (shift: 'day' | 'night' | 'medical', value: string) => void;
    updateHandoffStaff: (shift: 'day' | 'night', type: 'delivers' | 'receives' | 'tens', staffList: string[]) => void;
    updateMedicalSignature: (doctorName: string) => Promise<void>;
    updateMedicalHandoffDoctor: (doctorName: string) => Promise<void>;
    markMedicalHandoffAsSent: (doctorName?: string) => Promise<void>;
    sendMedicalHandoff: (templateContent: string, targetGroupId: string) => Promise<void>;
}

export const useHandoffManagement = (
    record: DailyRecord | null,
    saveAndUpdate: (updatedRecord: DailyRecord) => Promise<void>,
    patchRecord: (partial: DailyRecordPatch) => Promise<void>
): HandoffManagementActions => {
    const { success, error: notifyError } = useNotification();
    const { logEvent, logDebouncedEvent, userId } = useAuditContext();

    const updateHandoffChecklist = useCallback((shift: 'day' | 'night', field: string, value: boolean | string) => {
        if (!record) return;

        const updatedRecord = { ...record };

        if (shift === 'day') {
            updatedRecord.handoffDayChecklist = {
                ...updatedRecord.handoffDayChecklist,
                [field]: value
            };
        } else {
            updatedRecord.handoffNightChecklist = {
                ...updatedRecord.handoffNightChecklist,
                [field]: value
            };
        }

        updatedRecord.lastUpdated = new Date().toISOString();
        saveAndUpdate(updatedRecord);
    }, [record, saveAndUpdate]);

    const updateHandoffNovedades = useCallback((shift: 'day' | 'night' | 'medical', value: string) => {
        if (!record) return;

        const updatedRecord = { ...record };

        if (shift === 'day') {
            updatedRecord.handoffNovedadesDayShift = value;
        } else if (shift === 'night') {
            updatedRecord.handoffNovedadesNightShift = value;
        } else if (shift === 'medical') {
            updatedRecord.medicalHandoffNovedades = value;
        }

        updatedRecord.lastUpdated = new Date().toISOString();
        saveAndUpdate(updatedRecord);

        // Audit Log (Smart/Debounced)
        const authors = getAttributedAuthors(userId, record, shift === 'medical' ? undefined : (shift as 'day' | 'night'));

        const oldContent = shift === 'day'
            ? record.handoffNovedadesDayShift
            : (shift === 'night' ? record.handoffNovedadesNightShift : record.medicalHandoffNovedades);

        logDebouncedEvent(
            'HANDOFF_NOVEDADES_MODIFIED',
            'dailyRecord',
            record.date,
            {
                shift,
                value,
                changes: {
                    novedades: { old: oldContent || '', new: value }
                }
            },
            undefined,
            record.date,
            authors
        );
    }, [record, saveAndUpdate, logDebouncedEvent, userId]);

    const updateHandoffStaff = useCallback((shift: 'day' | 'night', type: 'delivers' | 'receives' | 'tens', staffList: string[]) => {
        if (!record) return;

        const updatedRecord = { ...record };

        if (shift === 'day') {
            if (type === 'delivers') {
                updatedRecord.nursesDayShift = staffList;
            } else if (type === 'receives') {
                updatedRecord.nursesNightShift = staffList;
            } else if (type === 'tens') {
                updatedRecord.tensDayShift = staffList;
            }
        } else {
            if (type === 'delivers') {
                updatedRecord.nursesNightShift = staffList;
            } else if (type === 'receives') {
                updatedRecord.handoffNightReceives = staffList;
            } else if (type === 'tens') {
                updatedRecord.tensNightShift = staffList;
            }
        }

        updatedRecord.lastUpdated = new Date().toISOString();
        saveAndUpdate(updatedRecord);
    }, [record, saveAndUpdate]);

    const updateMedicalSignature = useCallback(async (doctorName: string) => {
        if (!record) return;

        const updatedRecord = { ...record };
        const signedAt = new Date().toISOString();

        updatedRecord.medicalSignature = {
            doctorName,
            signedAt
        };

        updatedRecord.lastUpdated = new Date().toISOString();
        await saveAndUpdate(updatedRecord);

        // Audit Log
        logEvent(
            'MEDICAL_HANDOFF_SIGNED',
            'dailyRecord',
            record.date,
            {
                doctorName,
                signedAt
            },
            undefined,
            record.date
        );
    }, [record, saveAndUpdate, logEvent]);

    const updateMedicalHandoffDoctor = useCallback(async (doctorName: string): Promise<void> => {
        if (!record) return;

        const updatedRecord = { ...record };
        updatedRecord.medicalHandoffDoctor = doctorName;
        updatedRecord.lastUpdated = new Date().toISOString();
        await saveAndUpdate(updatedRecord);
    }, [record, saveAndUpdate]);

    const markMedicalHandoffAsSent = useCallback((doctorName?: string) => {
        if (!record) return Promise.resolve();

        const updates: Partial<DailyRecord> = {
            medicalHandoffSentAt: new Date().toISOString()
        };
        if (doctorName) {
            updates.medicalHandoffDoctor = doctorName;
        }
        return patchRecord(updates);
    }, [record, patchRecord]);

    const sendMedicalHandoff = useCallback(async (templateContent: string, targetGroupId: string) => {
        if (!record) return;

        try {
            // 1. Get Doctor Name (Auto-fill from previous if empty)
            let doctorName = record.medicalHandoffDoctor;
            if (!doctorName) {
                const previousRecord = await getPreviousDay(record.date);
                doctorName = previousRecord?.medicalHandoffDoctor || 'Sin especificar';
            }

            // 2. Calculate Stats (Replica of HandoffView logic)
            const activeExtras = record.activeExtraBeds || [];
            const visibleBeds = BEDS.filter(bed => !bed.isExtra || activeExtras.includes(bed.id));

            const hospitalized = visibleBeds.filter(b =>
                record.beds[b.id].patientName && !record.beds[b.id].isBlocked
            ).length;
            const blockedBeds = visibleBeds.filter(b => record.beds[b.id].isBlocked).length;
            const freeBeds = visibleBeds.length - hospitalized - blockedBeds;

            // 3. Format Message
            const [year, month, day] = record.date.split('-');
            const dateStr = `${day}-${month}-${year}`;
            const handoffUrl = `${window.location.origin}?mode=signature&date=${record.date}`;

            const message = formatHandoffMessage(templateContent, {
                date: dateStr,
                signedBy: doctorName,
                signedAt: new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }),
                hospitalized,
                freeBeds,
                newAdmissions: 0,
                discharges: 0,
                handoffUrl
            });

            // 4. Send WhatsApp
            const result = await sendWhatsAppMessage(targetGroupId, message);
            if (!result.success) {
                throw new Error(result.error);
            }

            success('WhatsApp Enviado', 'Entrega médica enviada correctamente.');

            // 5. Atomic Patch Update
            await patchRecord({
                medicalHandoffDoctor: doctorName,
                medicalHandoffSentAt: new Date().toISOString()
            });

        } catch (err: unknown) {
            console.error('WhatsApp Logic Error:', err);
            const errorMessage = err instanceof Error ? err.message : 'Error desconocido';
            notifyError('Error al enviar', errorMessage);
        }
    }, [record, patchRecord, success, notifyError]);

    return {
        updateHandoffChecklist,
        updateHandoffNovedades,
        updateHandoffStaff,
        updateMedicalSignature,
        updateMedicalHandoffDoctor,
        markMedicalHandoffAsSent,
        sendMedicalHandoff
    };
};
