import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import { createScopedLogger } from '@/services/utils/loggerScope';
import * as z from 'zod';

const fugaNotificationResponseSchema = z.object({
  success: z.boolean(),
  message: z.string(),
  gmailId: z.string(),
});

const logger = createScopedLogger('fugaNotificationService');

const DEFAULT_FUGA_NOTIFICATION_ENDPOINT = '/.netlify/functions/send-fuga-notification';

export interface FugaNotificationPayload {
  patientName: string;
  rut: string;
  diagnosis: string;
  bedName: string;
  specialty?: string;
  recordDate: string;
  time: string;
  automaticMessage: string;
  nursesSignature?: string;
  note?: string;
  recipients?: string[];
  testMode?: boolean;
  testRecipient?: string;
}

export interface FugaNotificationResponse {
  success: boolean;
  message: string;
  gmailId: string;
}

export const sendFugaNotification = async (
  payload: FugaNotificationPayload
): Promise<FugaNotificationResponse> => {
  const endpoint =
    import.meta.env.VITE_FUGA_EMAIL_ENDPOINT?.trim() || DEFAULT_FUGA_NOTIFICATION_ENDPOINT;

  const authHeaders = await resolveCurrentUserAuthHeaders();

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(error => {
      logger.warn('Failed to read fuga notification error response', error);
      return 'No se pudo enviar la notificación.';
    });
    throw new Error(errorText || 'No se pudo enviar la notificación.');
  }

  return fugaNotificationResponseSchema.parse(await response.json());
};
