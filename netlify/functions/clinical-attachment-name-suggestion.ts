import { getFirebaseServer } from './lib/firebase-server';
import { authorizeRoleRequest, extractBearerToken } from './lib/firebase-auth';
import { generateClinicalAIText, resolveClinicalAIProviderConfig } from './lib/ai-provider';
import { loadClinicalAIRoutingConfigFromFirestore } from './lib/ai-provider-routing';
import { invokeWithTelemetry } from './lib/observability';
import {
  ClinicalAttachmentNameSuggestionRequestSchema,
  ClinicalAttachmentNameSuggestionResponseSchema,
} from '../../src/contracts/serverless';
import {
  buildJsonResponse,
  buildTooManyRequestsResponse,
  getClientIp,
  getRequestOrigin,
  isOriginAllowed,
  isRateLimited,
  parseJsonBody,
  type NetlifyEventLike,
} from './lib/http';

const CLINICAL_ATTACHMENT_NAME_ALLOWED_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
  'editor',
]);

interface ClinicalAttachmentNameSuggestionHandlerDependencies {
  getFirebaseServer: typeof getFirebaseServer;
  authorizeRoleRequest: typeof authorizeRoleRequest;
  extractBearerToken: typeof extractBearerToken;
  resolveClinicalAIProviderConfig: typeof resolveClinicalAIProviderConfig;
  generateClinicalAIText: typeof generateClinicalAIText;
  loadClinicalAIRoutingConfigFromFirestore?: typeof loadClinicalAIRoutingConfigFromFirestore;
}

const stripJsonFence = (value: string): string => {
  const trimmed = value.trim();
  const match = trimmed.match(/```(?:json|text)?\s*([\s\S]*?)```/);
  return match ? match[1].trim() : trimmed;
};

const removeUnsafeFileNameChars = (value: string): string =>
  value
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getFileExtension = (fileName: string): string => {
  const match = fileName.trim().match(/\.([A-Za-z0-9]{1,8})$/);
  return match ? `.${match[1].toLowerCase()}` : '';
};

export const sanitizeSuggestedAttachmentName = (
  rawName: string,
  originalFileName: string
): string | null => {
  const cleaned = removeUnsafeFileNameChars(stripJsonFence(rawName).replace(/^["']|["']$/g, ''));
  if (!cleaned) return null;

  const extension = getFileExtension(originalFileName);
  const withoutTrailingExtension = extension
    ? cleaned.replace(/\.[A-Za-z0-9]{1,8}$/i, '').trim()
    : cleaned;
  const baseName = withoutTrailingExtension.slice(0, 80).trim();
  if (!baseName) return null;
  return `${baseName}${extension}`;
};

export const buildClinicalAttachmentNameSuggestionPrompt = (
  request: ReturnType<typeof ClinicalAttachmentNameSuggestionRequestSchema.parse>
) => ({
  systemPrompt: [
    'Eres un asistente clinico que propone nombres cortos y seguros para archivos adjuntos.',
    'No incluyas nombres de pacientes, RUT, ficha, telefonos ni otros identificadores personales.',
    'Devuelve solo un nombre de archivo, sin Markdown, sin comillas y sin explicaciones.',
  ].join('\n'),
  userPrompt: [
    'Sugiere un nombre visible para este adjunto clinico.',
    'Debe ser especifico, breve, en espanol clinico, y conservar la extension original si existe.',
    '',
    `Nombre original: ${request.attachment.originalFileName}`,
    `Nombre visible actual: ${request.attachment.displayName}`,
    `Tipo de archivo: ${request.attachment.fileKind}`,
    `MIME: ${request.attachment.contentType || 'desconocido'}`,
    `Tipo de documento clinico: ${
      request.document?.documentType || request.attachment.documentType || 'no especificado'
    }`,
    `Fecha de hospitalizacion/documento: ${
      request.document?.admissionDate ||
      request.attachment.admissionDate ||
      request.document?.sourceDailyRecordDate ||
      request.attachment.sourceDailyRecordDate ||
      'no especificada'
    }`,
    '',
    'Ejemplos de estilo: Eco abdomen ingreso.pdf, Foto herida evolucion.jpg, Informe cardiologia.pdf.',
  ].join('\n'),
});

export const createClinicalAttachmentNameSuggestionHandler = (
  dependencies: ClinicalAttachmentNameSuggestionHandlerDependencies = {
    getFirebaseServer,
    authorizeRoleRequest,
    extractBearerToken,
    resolveClinicalAIProviderConfig,
    generateClinicalAIText,
    loadClinicalAIRoutingConfigFromFirestore,
  }
) => {
  return async (event: NetlifyEventLike) => {
    const requestOrigin = getRequestOrigin(event);

    if (!isOriginAllowed(requestOrigin)) {
      return buildJsonResponse(403, { error: 'Origin not allowed' }, { requestOrigin });
    }

    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          ...buildJsonResponse(200, {}, { requestOrigin }).headers,
          'Content-Length': '0',
        },
        body: '',
      };
    }

    if (event.httpMethod !== 'POST') {
      return buildJsonResponse(405, { error: 'Method not allowed' }, { requestOrigin });
    }

    const clientIp = getClientIp(event);
    if (isRateLimited(clientIp, { maxPerWindow: 20, windowMs: 60_000 })) {
      return buildTooManyRequestsResponse(requestOrigin);
    }

    const baselineProviderConfig = dependencies.resolveClinicalAIProviderConfig({
      action: 'clinical_attachment_name_suggestion',
    });
    if (!baselineProviderConfig) {
      return buildJsonResponse(
        200,
        ClinicalAttachmentNameSuggestionResponseSchema.parse({
          available: false,
          message: 'AI not configured',
        }),
        { requestOrigin }
      );
    }

    const authorizationHeader =
      typeof event.headers?.authorization === 'string'
        ? event.headers.authorization
        : typeof event.headers?.Authorization === 'string'
          ? event.headers.Authorization
          : undefined;

    let bearerToken: string;
    try {
      bearerToken = dependencies.extractBearerToken(authorizationHeader);
    } catch (error) {
      return buildJsonResponse(
        401,
        { error: error instanceof Error ? error.message : 'Authentication required.' },
        { requestOrigin }
      );
    }

    try {
      const { db } = dependencies.getFirebaseServer();
      await dependencies.authorizeRoleRequest(
        db,
        authorizationHeader,
        CLINICAL_ATTACHMENT_NAME_ALLOWED_ROLES
      );
      const routingConfig =
        (await dependencies.loadClinicalAIRoutingConfigFromFirestore?.({ bearerToken })) ?? null;
      const providerConfig = dependencies.resolveClinicalAIProviderConfig({
        action: 'clinical_attachment_name_suggestion',
        routingConfig,
      });

      if (!providerConfig) {
        return buildJsonResponse(
          200,
          ClinicalAttachmentNameSuggestionResponseSchema.parse({
            available: false,
            message: 'AI not configured',
          }),
          { requestOrigin }
        );
      }

      const body = parseJsonBody<unknown>(event.body);
      if (!body.ok) {
        return buildJsonResponse(400, { error: body.error }, { requestOrigin });
      }

      const request = ClinicalAttachmentNameSuggestionRequestSchema.safeParse(body.value);
      if (!request.success) {
        return buildJsonResponse(
          400,
          { error: 'Invalid attachment name request' },
          { requestOrigin }
        );
      }

      const prompt = buildClinicalAttachmentNameSuggestionPrompt(request.data);
      const aiText = await invokeWithTelemetry({
        service: 'clinical_ai',
        operation: 'clinical_attachment_name_suggestion',
        timeoutMs: 20_000,
        maxAttempts: 2,
        db,
        hospitalId: process.env.ACTIVE_HOSPITAL_ID || 'hanga_roa',
        context: {
          provider: providerConfig.provider,
          model: providerConfig.model,
          fileKind: request.data.attachment.fileKind,
        },
        fn: () =>
          dependencies.generateClinicalAIText({
            config: providerConfig,
            systemPrompt: prompt.systemPrompt,
            userPrompt: prompt.userPrompt,
            temperature: 0.1,
            maxTokens: 80,
          }),
      });

      const suggestedName = sanitizeSuggestedAttachmentName(
        aiText,
        request.data.attachment.originalFileName
      );
      if (!suggestedName) {
        return buildJsonResponse(
          502,
          { error: 'AI did not return a valid file name' },
          { requestOrigin }
        );
      }

      return buildJsonResponse(
        200,
        ClinicalAttachmentNameSuggestionResponseSchema.parse({
          available: true,
          provider: providerConfig.provider,
          model: providerConfig.model,
          suggestedName,
        }),
        { requestOrigin }
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Clinical attachment name suggestion failed';
      const statusCode =
        message.includes('Access denied') || message.includes('no email claim')
          ? 403
          : message.includes('Authorization')
            ? 401
            : 500;

      return buildJsonResponse(statusCode, { error: message }, { requestOrigin });
    }
  };
};

export const handler = createClinicalAttachmentNameSuggestionHandler();
