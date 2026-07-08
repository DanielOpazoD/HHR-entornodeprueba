import { getFirebaseServer } from './lib/firebase-server';
import { authorizeRoleRequest, extractBearerToken } from './lib/firebase-auth';
import { loadClinicalAIContextFromFirestore } from './lib/clinical-ai-context';
import { generateClinicalAIText, resolveClinicalAIProviderConfig } from './lib/ai-provider';
import { loadClinicalAIRoutingConfigFromFirestore } from './lib/ai-provider-routing';
import { invokeWithTelemetry } from './lib/observability';
import { buildClinicalAISummaryPrompt } from '../../src/application/ai/clinicalSummaryContextUseCase';
import {
  ClinicalSummaryRequestSchema,
  ClinicalSummaryResponseSchema,
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

const CLINICAL_SUMMARY_ALLOWED_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
  'editor',
]);

interface ClinicalAISummaryHandlerDependencies {
  getFirebaseServer: typeof getFirebaseServer;
  authorizeRoleRequest: typeof authorizeRoleRequest;
  extractBearerToken: typeof extractBearerToken;
  loadClinicalAIContextFromFirestore: typeof loadClinicalAIContextFromFirestore;
  resolveClinicalAIProviderConfig: typeof resolveClinicalAIProviderConfig;
  generateClinicalAIText: typeof generateClinicalAIText;
  loadClinicalAIRoutingConfigFromFirestore?: typeof loadClinicalAIRoutingConfigFromFirestore;
}

export const createClinicalAISummaryHandler = (
  dependencies: ClinicalAISummaryHandlerDependencies = {
    getFirebaseServer,
    authorizeRoleRequest,
    extractBearerToken,
    loadClinicalAIContextFromFirestore,
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

    // Rate limit only the real POST request so browser preflights do not consume quota.
    const clientIp = getClientIp(event);
    if (isRateLimited(clientIp, { maxPerWindow: 10, windowMs: 60_000 })) {
      return buildTooManyRequestsResponse(requestOrigin);
    }

    const baselineProviderConfig = dependencies.resolveClinicalAIProviderConfig();
    if (!baselineProviderConfig) {
      return buildJsonResponse(
        200,
        {
          available: false,
          summary: '',
          message: 'AI not configured',
        },
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
        CLINICAL_SUMMARY_ALLOWED_ROLES
      );
      const routingConfig =
        (await dependencies.loadClinicalAIRoutingConfigFromFirestore?.({ bearerToken })) ?? null;
      const providerConfig = dependencies.resolveClinicalAIProviderConfig({
        action: 'clinical_ai_summary',
        routingConfig,
      });

      if (!providerConfig) {
        return buildJsonResponse(
          200,
          {
            available: false,
            summary: '',
            message: 'AI not configured',
          },
          { requestOrigin }
        );
      }

      const body = parseJsonBody<unknown>(event.body);
      if (!body.ok) {
        return buildJsonResponse(400, { error: body.error }, { requestOrigin });
      }

      const request = ClinicalSummaryRequestSchema.safeParse(body.value);
      if (!request.success) {
        return buildJsonResponse(
          400,
          { error: 'recordDate y bedId son requeridos para resumir el contexto clínico.' },
          { requestOrigin }
        );
      }

      const recordDate = request.data.recordDate.trim();
      const bedId = request.data.bedId.trim();

      if (!recordDate || !bedId) {
        return buildJsonResponse(
          400,
          { error: 'recordDate y bedId son requeridos para resumir el contexto clínico.' },
          { requestOrigin }
        );
      }

      const context = await dependencies.loadClinicalAIContextFromFirestore({
        db,
        recordDate,
        bedId,
      });
      const prompt = buildClinicalAISummaryPrompt({
        context,
        instruction: request.data.instruction,
      });
      const summary = await invokeWithTelemetry({
        service: 'clinical_ai',
        operation: 'summary',
        timeoutMs: 45_000,
        maxAttempts: 2,
        db,
        hospitalId: process.env.ACTIVE_HOSPITAL_ID || 'hanga_roa',
        context: {
          provider: providerConfig.provider,
          model: providerConfig.model,
          recordDate,
          bedId,
        },
        fn: () =>
          dependencies.generateClinicalAIText({
            config: providerConfig,
            systemPrompt: prompt.systemPrompt,
            userPrompt: prompt.userPrompt,
          }),
      });

      return buildJsonResponse(
        200,
        ClinicalSummaryResponseSchema.parse({
          available: true,
          provider: providerConfig.provider,
          model: providerConfig.model,
          summary,
        }),
        { requestOrigin }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Clinical AI summary failed';
      const statusCode =
        message.includes('Access denied') || message.includes('no email claim')
          ? 403
          : message.includes('Authorization')
            ? 401
            : message.includes('not found') || message.includes('Patient not found')
              ? 404
              : 500;

      return buildJsonResponse(statusCode, { error: message }, { requestOrigin });
    }
  };
};

export const handler = createClinicalAISummaryHandler();
