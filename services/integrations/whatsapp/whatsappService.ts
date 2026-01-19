/**
 * WhatsApp Service - React Integration
 * 
 * Service for communicating with WhatsApp bot server
 * and managing WhatsApp configuration in Firestore
 */

import {
    doc,
    getDoc,
    setDoc,
    collection,
    addDoc,
    query,
    orderBy,
    limit,
    onSnapshot,
    Timestamp
} from 'firebase/firestore';
import { db } from '../../../firebaseConfig';
import type { WhatsAppConfig, WhatsAppLog, WeeklyShift } from '../../../types';

// Bot server URL (configurable)
const BOT_SERVER_URL = (() => {
    const envUrl = import.meta.env.VITE_WHATSAPP_BOT_URL?.trim();
    if (envUrl) {
        return envUrl.replace(/\/$/, '');
    }

    // On Netlify, use the serverless proxy (avoids CORS and hides the real bot URL)
    if (!import.meta.env.DEV) {
        return '/.netlify/functions/whatsapp-proxy';
    }

    // Local fallback for development
    return 'http://localhost:3001';
})();

const buildBotUrl = (path: string) => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${BOT_SERVER_URL}${normalizedPath}`;
};

// ============================================
// BOT COMMUNICATION
// ============================================

/**
 * Check if bot server is running and connected
 */
export async function checkBotHealth(): Promise<{
    status: 'ok' | 'error';
    whatsapp: 'connected' | 'disconnected';
    uptime?: number;
    error?: string;
}> {
    try {
        const response = await fetch(buildBotUrl('/health'), {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            return { status: 'error', whatsapp: 'disconnected', error: 'Bot server not responding' };
        }

        return await response.json();
    } catch (error) {
        return {
            status: 'error',
            whatsapp: 'disconnected',
            error: 'Cannot connect to bot server'
        };
    }
}

/**
 * Send a message via WhatsApp bot
 */
export async function sendWhatsAppMessage(
    groupId: string,
    message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
        const response = await fetch(buildBotUrl('/send-message'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId, message })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to send message');
        }

        // Log the send operation
        await logWhatsAppOperation({
            type: 'HANDOFF_SENT',
            method: 'MANUAL',
            success: true,
            metadata: { groupId, messageLength: message.length }
        });

        return { success: true, messageId: result.messageId };
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        await logWhatsAppOperation({
            type: 'ERROR',
            success: false,
            error: errorMessage
        });

        return { success: false, error: errorMessage };
    }
}

/**
 * Get list of WhatsApp groups from bot
 */
export async function getWhatsAppGroups(): Promise<Array<{ id: string; name: string }>> {
    try {
        const response = await fetch(buildBotUrl('/groups'));
        if (!response.ok) throw new Error('Failed to fetch groups');
        return await response.json();
    } catch (error) {
        console.error('Error fetching groups:', error);
        return [];
    }
}

/**
 * Fetch and process shift messages from the configured WhatsApp group
 */
export async function fetchShiftsFromGroup(): Promise<{
    success: boolean;
    message: string;
    error?: string;
}> {
    try {
        const response = await fetch(buildBotUrl('/fetch-shifts'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const result = await response.json();

        if (!response.ok) {
            return {
                success: false,
                message: '',
                error: result.error || 'Error al buscar turnos'
            };
        }

        return {
            success: result.success,
            message: result.message
        };
    } catch (error: unknown) {
        return {
            success: false,
            message: '',
            error: 'No se pudo conectar al bot server. Verifica que esté corriendo.'
        };
    }
}

// ============================================
// CONFIGURATION
// ============================================

/**
 * Get WhatsApp configuration from Firestore
 */
export async function getWhatsAppConfig(): Promise<WhatsAppConfig | null> {
    try {
        const docRef = doc(db, 'whatsapp', 'config');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return docSnap.data() as WhatsAppConfig;
        }

        // Return default config if none exists
        return {
            enabled: true,
            status: 'disconnected',
            shiftParser: {
                enabled: true,
                sourceGroupId: ''
            },
            handoffNotifications: {
                enabled: true,
                targetGroupId: '',
                autoSendTime: '17:00'
            }
        };
    } catch (error) {
        console.error('Error getting WhatsApp config:', error);
        return null;
    }
}

/**
 * Update WhatsApp configuration
 */
export async function updateWhatsAppConfig(
    config: Partial<WhatsAppConfig>
): Promise<boolean> {
    try {
        const docRef = doc(db, 'whatsapp', 'config');
        await setDoc(docRef, config, { merge: true });
        return true;
    } catch (error) {
        console.error('Error updating WhatsApp config:', error);
        return false;
    }
}

// ============================================
// MESSAGE TEMPLATES
// ============================================

export interface MessageTemplate {
    id?: string;
    name: string;
    content: string;
    type: 'handoff' | 'shift' | 'custom';
    createdAt?: Timestamp;
}

/**
 * Get all message templates
 */
export async function getMessageTemplates(): Promise<MessageTemplate[]> {
    try {
        const docRef = doc(db, 'whatsapp', 'templates');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return docSnap.data().templates || [];
        }

        // Return default templates
        return getDefaultTemplates();
    } catch (error) {
        console.error('Error getting templates:', error);
        return getDefaultTemplates();
    }
}

/**
 * Save message templates
 */
export async function saveMessageTemplates(
    templates: MessageTemplate[]
): Promise<boolean> {
    try {
        const docRef = doc(db, 'whatsapp', 'templates');
        await setDoc(docRef, { templates }, { merge: true });
        return true;
    } catch (error) {
        console.error('Error saving templates:', error);
        return false;
    }
}

/**
 * Get default message templates
 */
export function getDefaultTemplates(): MessageTemplate[] {
    return [
        {
            id: 'handoff-default',
            name: 'Entrega de Turno Estándar',
            type: 'handoff',
            content: `🏥 Hospital Hanga Roa
📋 Entrega de Turno Médico

📅 Fecha: {{date}}
👨‍⚕️ Entregado por: {{signedBy}}
🕐 Firmado: {{signedAt}}

📊 Resumen:
• Hospitalizados: {{hospitalized}} pacientes
• Camas libres: {{freeBeds}}
• Nuevos ingresos: {{newAdmissions}}
• Altas: {{discharges}}

🔗 Ver entrega completa:
{{handoffUrl}}

- Enviado automáticamente por Sistema HHR`
        },
        {
            id: 'handoff-urgent',
            name: 'Entrega Urgente',
            type: 'handoff',
            content: `🚨 ENTREGA URGENTE - Hospital Hanga Roa

📅 {{date}} - {{signedAt}}
👨‍⚕️ {{signedBy}}

⚠️ Pacientes críticos: {{criticalPatients}}
📊 Camas libres: {{freeBeds}}

🔗 Ver entrega: {{handoffUrl}}`
        }
    ];
}

// ============================================
// LOGGING
// ============================================

/**
 * Log a WhatsApp operation
 */
export async function logWhatsAppOperation(log: Omit<WhatsAppLog, 'id' | 'timestamp'>): Promise<void> {
    try {
        await addDoc(collection(db, 'whatsappLogs'), {
            ...log,
            timestamp: Timestamp.now()
        });
    } catch (error) {
        console.error('Error logging WhatsApp operation:', error);
    }
}

// ============================================
// SHIFTS
// ============================================

/**
 * Subscribe to current weekly shift
 * Shows the most recent shift without strict date validation
 * Messages can arrive late, so we trust the most recent entry
 */
export function subscribeToCurrentShift(
    callback: (shift: WeeklyShift | null) => void
): () => void {
    const shiftsRef = collection(db, 'shifts', 'weekly', 'data');
    const q = query(shiftsRef, orderBy('parsedAt', 'desc'), limit(1));

    return onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            // console.debug('No hay turnos en Firestore');
            callback(null);
            return;
        }

        const docRef = snapshot.docs[0];
        const shift = docRef.data() as WeeklyShift;

        // console.debug('Turno encontrado:', shift.startDate, '-', shift.endDate);

        // Always show the most recent shift
        // The user can import a new one when needed
        callback(shift);
    });
}

/**
 * Save a shift manually by parsing a WhatsApp message text
 */
export async function saveManualShift(messageText: string): Promise<{ success: boolean; error?: string }> {
    try {
        // console.info('Importando turno manual...');
        // console.debug('Mensaje recibido:', messageText.substring(0, 100) + '...');

        // Parse dates from message
        const lowerMessage = messageText.toLowerCase();
        if (!lowerMessage.includes('turno pabellon') &&
            !lowerMessage.includes('turno pabellón') &&
            !lowerMessage.includes('envío turno') &&
            !lowerMessage.includes('envio turno')) {
            console.warn('⚠️ No se encontró palabra clave de turno');
            return { success: false, error: 'El mensaje no parece ser un turno de pabellón' };
        }

        // Extract dates
        let startDate = '';
        let endDate = '';

        const dateMatch = messageText.match(/del\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+hasta\s+el\s+(\d{1,2}\/\d{1,2}\/\d{4})/i);
        // console.debug('Regex match:', dateMatch);

        if (dateMatch) {
            const [, start, end] = dateMatch;
            const [startDay, startMonth, startYear] = start.split('/');
            const [endDay, endMonth, endYear] = end.split('/');
            startDate = `${startYear}-${startMonth.padStart(2, '0')}-${startDay.padStart(2, '0')}`;
            endDate = `${endYear}-${endMonth.padStart(2, '0')}-${endDay.padStart(2, '0')}`;
            // console.debug('Fechas parseadas:', startDate, '-', endDate);
        }

        if (!startDate || !endDate) {
            console.warn('⚠️ No se encontraron fechas');
            return { success: false, error: 'No se encontraron fechas en el mensaje (formato: del DD/MM/YYYY hasta el DD/MM/YYYY)' };
        }

        // Create shift document
        const shift: WeeklyShift = {
            startDate,
            endDate,
            source: 'manual' as const,
            parsedAt: new Date().toISOString(),
            staff: [], // Empty - we'll just show original message
            originalMessage: messageText
        };

        // console.debug('Guardando en Firestore...');

        // Save to Firestore
        const shiftsRef = collection(db, 'shifts', 'weekly', 'data');
        await setDoc(doc(shiftsRef, startDate), shift);

        // console.info('✅ Turno guardado exitosamente');
        return { success: true };
    } catch (error: unknown) {
        console.error('Error saving manual shift:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Error al guardar el turno' };
    }
}

/**
 * Format handoff message using template
 */
export function formatHandoffMessage(
    template: string,
    data: {
        date: string;
        signedBy: string;
        signedAt: string;
        hospitalized: number;
        freeBeds: number;
        newAdmissions: number;
        discharges: number;
        handoffUrl: string;
        criticalPatients?: number;
    }
): string {
    return template
        .replace(/\{\{date\}\}/g, data.date)
        .replace(/\{\{signedBy\}\}/g, data.signedBy)
        .replace(/\{\{signedAt\}\}/g, data.signedAt)
        .replace(/\{\{hospitalized\}\}/g, String(data.hospitalized))
        .replace(/\{\{freeBeds\}\}/g, String(data.freeBeds))
        .replace(/\{\{newAdmissions\}\}/g, String(data.newAdmissions))
        .replace(/\{\{discharges\}\}/g, String(data.discharges))
        .replace(/\{\{handoffUrl\}\}/g, data.handoffUrl)
        .replace(/\{\{criticalPatients\}\}/g, String(data.criticalPatients || 0));
}
