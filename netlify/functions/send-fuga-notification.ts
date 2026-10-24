import * as z from 'zod';
import { sendCensusEmail } from '../../src/services/email/gmailClient';
import { getFirebaseServer } from './lib/firebase-server';
import {
  buildCorsHeaders,
  buildJsonResponse,
  buildTextResponse,
  buildTooManyRequestsResponse,
  getClientIp,
  getRequestOrigin,
  isOriginAllowed,
  isRateLimited,
  parseJsonBody,
  type NetlifyEventLike,
} from './lib/http';
import { authorizeRoleRequest, extractBearerToken } from './lib/firebase-auth';
import { invokeWithTelemetry } from './lib/observability';
import { formatDateDDMMYYYY } from '../../src/utils/dateUtils';
import {
  buildFugaNotificationBody,
  parseFugaRecipientConfig,
  resolveFugaRecipients,
  validateFugaNotificationRequest,
} from '../../src/features/census/controllers/fugaNotificationPolicyController';

const ALLOWED_ROLES = new Set(['nurse_hospital', 'admin']);

const FugaNotificationPayloadSchema = z.object({
  patientName: z.string().min(1),
  rut: z.string().min(1),
  diagnosis: z.string().min(1),
  bedName: z.string().min(1),
  specialty: z.string().optional(),
  recordDate: z.string().min(1),
  time: z.string().min(1),
  automaticMessage: z.string().min(1),
  nursesSignature: z.string().optional(),
  note: z.string().optional(),
  recipients: z.array(z.string().email()).optional(),
  testMode: z.boolean().optional(),
  testRecipient: z.string().email().optional(),
});

const resolvePsychiatryRecipientsFromEnv = (): string[] =>
  parseFugaRecipientConfig(process.env.FUGA_PSYCHIATRY_RECIPIENTS);

export const handler = async (event: NetlifyEventLike) => {
  const requestOrigin = getRequestOrigin(event);
  const corsHeaders = buildCorsHeaders(requestOrigin, {
    allowedHeaders: 'Content-Type, Authorization, Accept, X-User-Role',
    allowedMethods: 'POST,OPTIONS',
  });

  if (!isOriginAllowed(requestOrigin)) {
    return buildJsonResponse(403, { error: 'Origin not allowed' }, { requestOrigin });
  }

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return buildTextResponse(405, 'Método no permitido', { requestOrigin });
  }

  // Rate limit only the actual POST request, not the CORS preflight.
  const clientIp = getClientIp(event);
  if (isRateLimited(clientIp, { maxPerWindow: 5, windowMs: 60_000 })) {
    return buildTooManyRequestsResponse(requestOrigin);
  }

  try {
    const { db } = getFirebaseServer();
    const authorizationHeader =
      typeof event.headers?.authorization === 'string'
        ? event.headers.authorization
        : typeof event.headers?.Authorization === 'string'
          ? event.headers.Authorization
          : undefined;

    try {
      extractBearerToken(authorizationHeader);
    } catch (error) {
      return buildTextResponse(
        401,
        error instanceof Error ? error.message : 'Authentication required.',
        { requestOrigin }
      );
    }

    let authContext: Awaited<ReturnType<typeof authorizeRoleRequest>>;
    try {
      authContext = await authorizeRoleRequest(db, authorizationHeader, ALLOWED_ROLES);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'No autorizado para enviar notificaciones de fuga.';
      const statusCode =
        message.includes('Access denied') || message.includes('no email claim') ? 403 : 401;
      return buildTextResponse(statusCode, message, { requestOrigin });
    }

    const parsedBody = parseJsonBody<unknown>(event.body);
    if (!parsedBody.ok) {
      return buildTextResponse(400, parsedBody.error, { requestOrigin });
    }

    const validatedBody = FugaNotificationPayloadSchema.safeParse(parsedBody.value);
    if (!validatedBody.success) {
      return buildTextResponse(400, 'Solicitud inválida para notificación de fuga.', {
        requestOrigin,
      });
    }

    const payload = validatedBody.data;

    if (payload.testMode && authContext.role !== 'admin') {
      return buildTextResponse(403, 'Solo un usuario admin puede usar modo prueba.', {
        requestOrigin,
      });
    }

    const resolvedRecipients = resolveFugaRecipients({
      specialty: payload.specialty,
      recipients: payload.recipients,
      testMode: payload.testMode,
      testRecipient: payload.testRecipient,
      psychiatryRecipients: resolvePsychiatryRecipientsFromEnv(),
    });
    const validation = validateFugaNotificationRequest({
      automaticMessage: payload.automaticMessage,
      resolvedRecipients,
      requireAutomaticRecipients: true,
    });

    if (!validation.isValid) {
      return buildTextResponse(
        400,
        validation.error || 'No se pudo validar la notificación de fuga.',
        { requestOrigin }
      );
    }

    const subject = `Notificación de fuga paciente ${payload.patientName} - ${formatDateDDMMYYYY(payload.recordDate)}`;
    const body = buildFugaNotificationBody(payload);

    const gmailResponse = await invokeWithTelemetry({
      service: 'gmail',
      operation: 'send_fuga_notification',
      timeoutMs: 15_000,
      maxAttempts: 1, // no retry: duplicate fuga notification is worse than missed delivery
      db,
      hospitalId: process.env.ACTIVE_HOSPITAL_ID || 'hanga_roa',
      context: {
        recordDate: payload.recordDate,
        recipientCount: resolvedRecipients.recipients.length,
        testMode: Boolean(payload.testMode),
      },
      fn: () =>
        sendCensusEmail({
          date: payload.recordDate,
          recipients: resolvedRecipients.recipients,
          subject,
          body,
        }),
    });

    return buildJsonResponse(
      200,
      {
        success: true,
        message: 'Notificación de fuga enviada correctamente.',
        gmailId: gmailResponse.id || '',
      },
      { requestOrigin }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error enviando notificación de fuga.';
    return buildTextResponse(500, message, { requestOrigin });
  }
};
