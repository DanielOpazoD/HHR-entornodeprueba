/**
 * WhatsApp Service - public facade
 *
 * Keeps a stable API for hooks/components while delegating
 * bot communication, Firestore config, templates and shift persistence
 * to smaller internal modules.
 */

import type { WeeklyShift } from '@/features/whatsapp/types/whatsapp';
import { fetchBotJson } from '@/features/whatsapp/services/whatsappBotRuntime';
import { logWhatsAppOperation } from '@/features/whatsapp/services/whatsappLogging';
import {
  getWhatsAppConfig,
  updateWhatsAppConfig,
} from '@/features/whatsapp/services/whatsappConfigStore';
import {
  getDefaultTemplates,
  getMessageTemplates,
  saveMessageTemplates,
} from '@/features/whatsapp/services/whatsappTemplatesStore';
import type { MessageTemplate } from '@/features/whatsapp/services/whatsappTemplatesStore';
import {
  saveManualShift,
  subscribeToCurrentShift,
} from '@/features/whatsapp/services/whatsappShiftStore';
import { whatsappServiceLogger } from '@/services/integrations/integrationLoggers';
import * as z from 'zod';

export type { MessageTemplate };

const whatsAppHealthSchema = z.object({
  status: z.enum(['ok', 'error']),
  whatsapp: z.enum(['connected', 'disconnected']),
  uptime: z.number().optional(),
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
