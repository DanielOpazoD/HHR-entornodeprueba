/**
 * WhatsApp Send Button Component
 * 
 * Button to manually send handoff notification via WhatsApp
 */

import React, { useState } from 'react';
import { Send, Check, Clock, RefreshCw, AlertCircle } from 'lucide-react';
import {
    sendWhatsAppMessage,
    getWhatsAppConfig,
    getMessageTemplates,
    formatHandoffMessage
} from '@/services/integrations/whatsapp/whatsappService';

interface WhatsAppSendButtonProps {
    /** Handoff data to send */
    handoffData: {
        id: string;
        date: string;
        signedBy: string;
        signedAt: string;
        hospitalized: number;
        freeBeds: number;
        newAdmissions: number;
        discharges: number;
    };
    /** Current WhatsApp status (optional, will be fetched if not provided) */
    whatsappStatus?: {
        sent: boolean;
        sentAt?: string;
        method?: 'MANUAL' | 'AUTO';
    };
    /** Callback after successful send */
    onSent?: (result: { success: boolean; sentAt: string }) => void;
}

type SendStatus = 'idle' | 'sending' | 'sent' | 'error';

export const WhatsAppSendButton: React.FC<WhatsAppSendButtonProps> = ({
    handoffData,
    whatsappStatus,
    onSent
}) => {
    const [status, setStatus] = useState<SendStatus>(
        whatsappStatus?.sent ? 'sent' : 'idle'
    );
    const [error, setError] = useState<string | null>(null);
    const [sentAt, setSentAt] = useState<string | null>(whatsappStatus?.sentAt || null);

    const handleSend = async () => {
        setStatus('sending');
        setError(null);

        try {
            // Get config
            const config = await getWhatsAppConfig();
            if (!config?.handoffNotifications.enabled) {
                throw new Error('WhatsApp notifications desactivadas');
            }

            if (!config.handoffNotifications.targetGroupId) {
                throw new Error('Grupo de destino no configurado');
            }

            // Get template
            const templates = await getMessageTemplates();
            const template = templates.find(t => t.type === 'handoff') || templates[0];

            if (!template) {
                throw new Error('No hay plantilla de mensaje configurada');
            }

            // Format message
            const handoffUrl = `${window.location.origin}/handoff/view/${handoffData.id}`;
            const message = formatHandoffMessage(template.content, {
                ...handoffData,
                handoffUrl
            });

            // Send
            const result = await sendWhatsAppMessage(
                config.handoffNotifications.targetGroupId,
                message
            );

            if (!result.success) {
                throw new Error(result.error || 'Error al enviar mensaje');
            }

            const now = new Date().toLocaleTimeString('es-CL', {
                hour: '2-digit',
                minute: '2-digit'
            });

            setSentAt(now);
            setStatus('sent');

            onSent?.({ success: true, sentAt: now });

        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(errorMessage);
            setStatus('error');
        }
    };

    // Already sent
    if (status === 'sent' || whatsappStatus?.sent) {
        return (
            <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg text-green-700">
                <Check className="w-5 h-5" />
                <div>
                    <span className="font-medium">Enviado a WhatsApp</span>
                    <span className="text-sm ml-2">
                        ({sentAt || whatsappStatus?.sentAt})
                    </span>
                    {whatsappStatus?.method === 'AUTO' && (
                        <span className="text-xs ml-1">(automático)</span>
                    )}
                </div>
            </div>
        );
    }

    // Error state
    if (status === 'error') {
        return (
            <div className="space-y-2">
                <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-red-700">
                    <AlertCircle className="w-5 h-5" />
                    <span className="text-sm">{error}</span>
                </div>
                <button
                    onClick={handleSend}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                    <RefreshCw className="w-4 h-4" />
                    Reintentar
                </button>
            </div>
        );
    }

    // Sending state
    if (status === 'sending') {
        return (
            <button
                disabled
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-500 rounded-lg cursor-not-allowed"
            >
                <RefreshCw className="w-4 h-4 animate-spin" />
                Enviando...
            </button>
        );
    }

    // Idle state - ready to send
    return (
        <div className="space-y-2">
            <button
                onClick={handleSend}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm"
            >
                <Send className="w-4 h-4" />
                Enviar a WhatsApp
            </button>
            <p className="text-xs text-gray-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Si no envías manualmente, se enviará automáticamente a las 17:00
            </p>
        </div>
    );
};

export default WhatsAppSendButton;
