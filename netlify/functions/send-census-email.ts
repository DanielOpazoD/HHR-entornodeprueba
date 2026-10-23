import { generateCensusPassword } from '../../src/services/security/passwordGenerator';
import { sendCensusEmail } from '../../src/services/email/gmailClient';
import { getFirebaseServer } from './lib/firebase-server';
import { CENSUS_DEFAULT_RECIPIENTS } from '../../src/constants/email';
import {
  validateExcelBuffer,
  validateExcelFilename,
  MIN_EXCEL_SIZE,
} from '../../src/services/exporters/excelValidation';
import type { DailyRecord } from '../../src/types/domain/dailyRecord';
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
import {
  CensusEmailRequestPayloadSchema,
  CensusEmailResponseSchema,
} from '../../src/contracts/serverless';

const ALLOWED_ROLES = new Set(['nurse_hospital', 'admin']);

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

    try {
      await authorizeRoleRequest(db, authorizationHeader, ALLOWED_ROLES);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No autorizado para enviar correos de censo.';
      const statusCode =
        message.includes('Access denied') || message.includes('no email claim') ? 403 : 401;
      return buildTextResponse(statusCode, message, { requestOrigin });
    }

    const parsedBody = parseJsonBody<unknown>(event.body);

    if (!parsedBody.ok) {
      return buildTextResponse(400, parsedBody.error, { requestOrigin });
    }

    const validatedBody = CensusEmailRequestPayloadSchema.safeParse(parsedBody.value);
    if (!validatedBody.success) {
      return buildTextResponse(400, 'Solicitud inválida: payload de envío de censo inválido.', {
        requestOrigin,
      });
    }

    const {
      date,
      records,
      recipients,
      nursesSignature,
      body: emailBody,
      shareLink,
      sheetDescriptors,
    } = validatedBody.data;

    if (typeof shareLink === 'string' && shareLink.trim().length > 0) {
      return buildTextResponse(
        400,
        'Solicitud inválida: el acceso por link al censo fue eliminado.',
        { requestOrigin }
      );
    }

    if (!date || !Array.isArray(records) || records.length === 0) {
      return buildTextResponse(400, 'Solicitud inválida: falta la fecha o los datos del censo.', {
        requestOrigin,
      });
    }

    const monthRecords = records
      .filter((r): r is DailyRecord => Boolean(r?.date))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (monthRecords.length === 0) {
      return buildTextResponse(400, 'No hay registros disponibles para generar el Excel maestro.', {
        requestOrigin,
      });
    }

    const { buildCensusMasterBuffer, getCensusMasterFilename } =
      await import('../../src/services/exporters/censusMasterWorkbook');
    const attachmentBufferRaw = await buildCensusMasterBuffer(monthRecords, {
      sheetDescriptors: Array.isArray(sheetDescriptors) ? sheetDescriptors : undefined,
    });
    const attachmentName = getCensusMasterFilename(date);

    // Validate buffer before proceeding
    const bufferValidation = validateExcelBuffer(attachmentBufferRaw);
    if (!bufferValidation.valid) {
      console.error('[CensusEmail] Buffer validation failed:', bufferValidation.error);
      return buildTextResponse(
        500,
        `Error: El archivo Excel generado es inválido. ${bufferValidation.error} No se enviará el correo.`,
        { requestOrigin }
      );
    }

    // Validate filename
    const filenameValidation = validateExcelFilename(attachmentName);
    if (!filenameValidation.valid) {
      console.error('[CensusEmail] Filename validation failed:', filenameValidation.error);
      return buildTextResponse(
        500,
        `Error: El nombre del archivo es inválido. ${filenameValidation.error}`,
        { requestOrigin }
      );
    }

    const password = generateCensusPassword(date);

    // Ensure the PIN is included in the email body
    let finalBody = emailBody || '';

    if (password && !finalBody.includes(password)) {
      const pinLine = `Clave Excel: ${password}`;
      // ... (keep existing logic for PIN insertion)
      if (finalBody.includes('Saludos cordiales,')) {
        finalBody = finalBody.replace('Saludos cordiales,', `${pinLine}\n\nSaludos cordiales,`);
      } else if (finalBody.includes('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')) {
        finalBody = finalBody.replace(
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          `${pinLine}\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        );
      } else {
        finalBody = finalBody ? `${finalBody}\n\n${pinLine}` : pinLine;
      }
    }

    const { default: XlsxPopulate } = await import('xlsx-populate');
    const attachmentBuffer = await XlsxPopulate.fromDataAsync(attachmentBufferRaw).then(workbook =>
      workbook.outputAsync({ password })
    );
    const encryptedAttachmentBuffer = Buffer.isBuffer(attachmentBuffer)
      ? attachmentBuffer
      : Buffer.from(attachmentBuffer);

    // Validate encrypted buffer
    if (encryptedAttachmentBuffer.length < MIN_EXCEL_SIZE) {
      console.error(
        '[CensusEmail] Encrypted buffer validation failed: buffer is too small or empty'
      );
      return buildTextResponse(
        500,
        'Error: El archivo Excel encriptado es inválido o está vacío. No se enviará el correo.',
        { requestOrigin }
      );
    }

    const resolvedRecipients: string[] =
      Array.isArray(recipients) && recipients.length > 0 ? recipients : CENSUS_DEFAULT_RECIPIENTS;

    const gmailResponse = await invokeWithTelemetry({
      service: 'gmail',
      operation: 'send_census_email',
      timeoutMs: 15_000,
      maxAttempts: 3,
      db,
      hospitalId: process.env.ACTIVE_HOSPITAL_ID || 'hanga_roa',
      context: {
        date,
        recipientCount: resolvedRecipients.length,
        attachmentBytes: encryptedAttachmentBuffer.length,
      },
      fn: () =>
        sendCensusEmail({
          date,
          recipients: resolvedRecipients,
          attachmentBuffer: encryptedAttachmentBuffer,
          attachmentName,
          nursesSignature,
          body: finalBody,
          encryptionPin: password || undefined,
        }),
    });

    return buildJsonResponse(
      200,
      CensusEmailResponseSchema.parse({
        success: true,
        message: 'Correo enviado correctamente.',
        gmailId: gmailResponse.id,
        censusDate: date,
        exportPassword: password,
      }),
      { requestOrigin }
    );
  } catch (error: unknown) {
    console.error('Error enviando correo de censo', error);
    const message =
      error instanceof Error ? error.message : 'Error desconocido enviando el correo.';
    return buildTextResponse(500, message, { requestOrigin });
  }
};
