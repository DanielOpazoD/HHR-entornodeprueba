import { getFirebaseServer } from './lib/firebase-server';
import { authorizeRoleRequest, extractBearerToken } from './lib/firebase-auth';
import { generateClinicalAIText, resolveClinicalAIProviderConfig } from './lib/ai-provider';
import { loadClinicalAIRoutingConfigFromFirestore } from './lib/ai-provider-routing';
import { invokeWithTelemetry } from './lib/observability';
import {
  ClinicalDocumentAiImportRequestSchema,
  ClinicalDocumentAiImportResponseSchema,
} from '../../src/contracts/serverless';
import {
  parseClinicalDocumentAiImportJson,
  sanitizeClinicalDocumentAiImportSourceText,
  validateClinicalDocumentAiImportSourceText,
} from '../../src/features/clinical-documents/contracts/clinicalDocumentAiImportContract';
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

const CLINICAL_DOCUMENT_AI_IMPORT_ALLOWED_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
  'editor',
]);

interface ClinicalDocumentAiImportHandlerDependencies {
  getFirebaseServer: typeof getFirebaseServer;
  authorizeRoleRequest: typeof authorizeRoleRequest;
  extractBearerToken: typeof extractBearerToken;
  resolveClinicalAIProviderConfig: typeof resolveClinicalAIProviderConfig;
  generateClinicalAIText: typeof generateClinicalAIText;
  loadClinicalAIRoutingConfigFromFirestore?: typeof loadClinicalAIRoutingConfigFromFirestore;
}

const stripJsonFence = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) return trimmed;

  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  return match ? match[1].trim() : trimmed;
};

export const buildClinicalDocumentAiImportPrompt = (sourceText: string) => ({
  systemPrompt: [
    'Eres un transformador de formato clinico para documentos hospitalarios en espanol.',
    'Tu tarea es ordenar contenido explicito de informes de traslado hacia una epicrisis de traslado.',
    'No diagnostiques, no resumas inventando y no agregues datos clinicos ausentes.',
    'Devuelve solo JSON valido, sin Markdown, sin comentarios y sin texto adicional.',
  ].join('\n'),
  userPrompt: [
    'Convierte el texto fuente en este JSON exacto:',
    '{"antecedentes":"","historiaEvolucionClinica":"","examenesComplementarios":"","diagnosticosEgreso":"","planEgreso":""}',
    '',
    'Reglas:',
    '- Usa solo informacion explicita del texto fuente.',
    '- Conserva negaciones, fechas, dosis, farmacos, procedimientos y nombres propios cuando aparezcan.',
    '- No copies identificadores administrativos del paciente dentro de las secciones: omite nombre, nombre completo, paciente, RUT, RUN, ficha o identificacion. Esos datos ya existen en el encabezado de la epicrisis.',
    '- Si una seccion no tiene informacion explicita, deja el string vacio.',
    '- planEgreso debe contener indicaciones y continuidad de manejo en el centro receptor cuando el informe de traslado lo indique.',
    '- No agregues conclusiones, diagnosticos, examenes ni tratamientos no mencionados.',
    '',
    'Texto fuente:',
    sourceText,
  ].join('\n'),
});

export const createClinicalDocumentAiImportHandler = (
  dependencies: ClinicalDocumentAiImportHandlerDependencies = {
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
    if (isRateLimited(clientIp, { maxPerWindow: 8, windowMs: 60_000 })) {
      return buildTooManyRequestsResponse(requestOrigin);
    }

    const baselineProviderConfig = dependencies.resolveClinicalAIProviderConfig();
    if (!baselineProviderConfig) {
      return buildJsonResponse(
        200,
        ClinicalDocumentAiImportResponseSchema.parse({
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
        CLINICAL_DOCUMENT_AI_IMPORT_ALLOWED_ROLES
      );
      const routingConfig =
        (await dependencies.loadClinicalAIRoutingConfigFromFirestore?.({ bearerToken })) ?? null;
      const providerConfig = dependencies.resolveClinicalAIProviderConfig({
        action: 'clinical_document_import',
        routingConfig,
      });

      if (!providerConfig) {
        return buildJsonResponse(
          200,
          ClinicalDocumentAiImportResponseSchema.parse({
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

      const request = ClinicalDocumentAiImportRequestSchema.safeParse(body.value);
      const sourceText = request.success ? request.data.sourceText : '';
      const sanitizedSourceText = sanitizeClinicalDocumentAiImportSourceText(sourceText);
      const sourceTextValidation = validateClinicalDocumentAiImportSourceText(sanitizedSourceText);

      if (!request.success || !sourceTextValidation.ok) {
        return buildJsonResponse(
          400,
          {
            error: 'Se requiere texto clinico extraido util para importar con IA.',
          },
          { requestOrigin }
        );
      }

      const prompt = buildClinicalDocumentAiImportPrompt(sanitizedSourceText);
      const aiText = await invokeWithTelemetry({
        service: 'clinical_ai',
        operation: 'clinical_document_import',
        timeoutMs: 45_000,
        maxAttempts: 2,
        db,
        hospitalId: process.env.ACTIVE_HOSPITAL_ID || 'hanga_roa',
        context: {
          provider: providerConfig.provider,
          model: providerConfig.model,
          sourceTextLength: sanitizedSourceText.length,
        },
        fn: () =>
          dependencies.generateClinicalAIText({
            config: providerConfig,
            systemPrompt: prompt.systemPrompt,
            userPrompt: prompt.userPrompt,
            temperature: 0.1,
            maxTokens: 1600,
          }),
      });

      const parsed = parseClinicalDocumentAiImportJson(stripJsonFence(aiText));
      if (parsed.status === 'failed') {
        return buildJsonResponse(502, { error: parsed.error }, { requestOrigin });
      }

      return buildJsonResponse(
        200,
        ClinicalDocumentAiImportResponseSchema.parse({
          available: true,
          provider: providerConfig.provider,
          model: providerConfig.model,
          document: parsed.data,
        }),
        { requestOrigin }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Clinical document AI import failed';
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

export const handler = createClinicalDocumentAiImportHandler();
