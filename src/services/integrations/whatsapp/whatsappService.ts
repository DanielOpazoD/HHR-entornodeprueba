/**
 * WhatsApp Service - public facade
 *
 * Keeps a stable API for hooks/components while delegating
 * bot communication, Firestore config, templates and shift persistence
 * to smaller internal modules.
 */

import type { WeeklyShift } from '@/types/whatsapp';
import { fetchBotJson } from '@/services/integrations/whatsapp/whatsappBotRuntime';
import { logWhatsAppOperation } from '@/services/integrations/whatsapp/whatsappLogging';
import {
  getWhatsAppConfig,
  updateWhatsAppConfig,
} from '@/services/integrations/whatsapp/whatsappConfigStore';
import {
  formatHandoffMessage,
  getDefaultTemplates,
  getMessageTemplates,
  saveMessageTemplates,
} from '@/services/integrations/whatsapp/whatsappTemplatesStore';
import type { MessageTemplate } from '@/services/integrations/whatsapp/whatsappTemplatesStore';
import {
  saveManualShift,
  subscribeToCurrentShift,
} from '@/services/integrations/whatsapp/whatsappShiftStore';
import { whatsappServiceLogger } from '@/services/integrations/integrationLoggers';
import * as z from 'zod';

export type { MessageTemplate };

const whatsAppHealthSchema = z.object({
  status: z.enum(['ok', 'error']),
  whatsapp: z.enum(['connected', 'disconnected']),
  uptime: z.number().optional(),
  error: z.string().optional(),
});

const whatsAppSendMessageSchema = z.object({
  success: z.boolean().optional(),
  messageId: z.string().optional(),
  error: z.string().optional(),
});

const whatsAppGroupListSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
  })
);

const whatsAppShiftFetchSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  error: z.string().optional(),
});

export async function checkBotHealth(): Promise<{
  status: 'ok' | 'error';
  whatsapp: 'connected' | 'disconnected';
  uptime?: number;
  error?: string;
}> {
  try {
    const response = await fetchBotJson('/health', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      return { status: 'error', whatsapp: 'disconnected', error: 'Bot server not responding' };
    }

    const payload = whatsAppHealthSchema.safeParse(await response.json());
    if (!payload.success) {
      return {
        status: 'error',
        whatsapp: 'disconnected',
        error: 'Bot server returned an invalid health payload',
      };
    }

    return payload.data;
  } catch (_error) {
    return {
      status: 'error',
      whatsapp: 'disconnected',
      error: 'Cannot connect to bot server',
    };
  }
}

export async function sendWhatsAppMessage(
  groupId: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const response = await fetchBotJson('/send-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId, message }),
    });

    const payload = whatsAppSendMessageSchema.safeParse(await response.json());
    const result = payload.success ? payload.data : { error: 'Invalid send-message payload' };
    if (!response.ok) {
      throw new Error(result.error || 'Failed to send message');
    }

    await logWhatsAppOperation({
      type: 'HANDOFF_SENT',
      method: 'MANUAL',
      success: true,
      metadata: { groupId, messageLength: message.length },
    });

    return { success: true, messageId: result.messageId };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    await logWhatsAppOperation({
      type: 'ERROR',
      success: false,
      error: errorMessage,
    });

    return { success: false, error: errorMessage };
  }
}

export async function getWhatsAppGroups(): Promise<Array<{ id: string; name: string }>> {
  try {
    const response = await fetchBotJson('/groups');
    if (!response.ok) {
      throw new Error('Failed to fetch groups');
    }

    const payload = whatsAppGroupListSchema.safeParse(await response.json());
    if (!payload.success) {
      throw new Error('Invalid WhatsApp groups payload');
    }

    return payload.data;
  } catch (error) {
    whatsappServiceLogger.info('Failed to fetch WhatsApp groups', error);
    return [];
  }
}

export async function fetchShiftsFromGroup(): Promise<{
  success: boolean;
  message: string;
  error?: string;
}> {
  try {
    const response = await fetchBotJson('/fetch-shifts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const payload = whatsAppShiftFetchSchema.safeParse(await response.json());
    const result = payload.success
      ? payload.data
      : {
          success: false,
          message: '',
          error: 'Respuesta inválida del bot de turnos',
        };
    if (!response.ok) {
      return {
        success: false,
        message: '',
        error: result.error || 'Error al buscar turnos',
      };
    }

    return {
      success: result.success,
      message: result.message,
      error: result.error,
    };
  } catch (_error: unknown) {
    return {
      success: false,
      message: '',
      error: 'No se pudo conectar al bot server. Verifica que esté corriendo.',
    };
  }
}

export {
  formatHandoffMessage,
  getDefaultTemplates,
  getMessageTemplates,
  getWhatsAppConfig,
  saveManualShift,
  saveMessageTemplates,
  subscribeToCurrentShift,
  updateWhatsAppConfig,
  logWhatsAppOperation,
};

export type { WeeklyShift };
