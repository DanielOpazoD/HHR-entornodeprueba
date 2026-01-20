import { useState, useCallback } from 'react';
import { DailyRecord } from '../types';
import { getWhatsAppConfig, getMessageTemplates } from '../services/integrations/whatsapp/whatsappService';

/**
 * useHandoffCommunication Hook
 * 
 * Handles WhatsApp integrations and link sharing for handoffs.
 */
export const useHandoffCommunication = (
    record: DailyRecord | null,
    visibleBeds: { id: string }[],
    sendMedicalHandoff: (content: string, groupId: string) => Promise<void>,
    onSuccess: (message: string, description?: string) => void
) => {
    const [whatsappSending, setWhatsappSending] = useState(false);
    const [whatsappSent, setWhatsappSent] = useState(false);

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
     * Sends the medical handoff summary via WhatsApp service.
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
     * Manual WhatsApp sharing pre-filled for browser opening.
     */
    const handleSendWhatsAppManual = useCallback(async () => {
        if (!record) return;
        try {
            const templates = await getMessageTemplates();
            const handoffTemplate = templates.find(t => t.type === 'handoff');
            if (!handoffTemplate) {
                throw new Error('No se encontró template de entrega médica');
            }

            // Calculate Stats
            const hospitalized = visibleBeds.filter(b => {
                const p = record.beds[b.id];
                return p && p.patientName && !p.isBlocked;
            }).length;

            const blockedBeds = visibleBeds.filter(b => record.beds[b.id]?.isBlocked).length;
            const freeBeds = visibleBeds.length - hospitalized - blockedBeds;

            const [year, month, day] = record.date.split('-');
            const dateStr = `${day}-${month}-${year}`;
            const handoffUrl = `${window.location.origin}?mode=signature&date=${dateStr}`;

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

    return {
        whatsappSending,
        whatsappSent,
        handleShareLink,
        handleSendWhatsApp,
        handleSendWhatsAppManual
    };
};
