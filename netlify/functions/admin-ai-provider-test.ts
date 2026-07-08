import { getFirebaseServer } from './lib/firebase-server';
import { authorizeRoleRequest, extractBearerToken } from './lib/firebase-auth';
import {
  generateClinicalAIText,
  resolveClinicalAIProviderConfig,
  type ClinicalAIAction,
  type ClinicalAIProvider,
} from './lib/ai-provider';
import {
  buildCorsHeaders,
  buildJsonResponse,
  getRequestOrigin,
  isOriginAllowed,
  parseJsonBody,
  type NetlifyEventLike,
} from './lib/http';

const ADMIN_AI_PROVIDER_TEST_ALLOWED_ROLES = new Set(['admin']);
const SUPPORTED_ACTIONS = new Set<ClinicalAIAction>([
  'clinical_ai_summary',
  'clinical_document_import',
  'cie10_search',
  'clinical_attachment_name_suggestion',
]);
const SUPPORTED_PROVIDERS = new Set<ClinicalAIProvider>([
  'gemini',
  'openai',
  'anthropic',
  'deepseek',
]);

interface AdminAIProviderTestRequest {
  action?: unknown;
  provider?: unknown;
  model?: unknown;
}

const parseProviderTestRequest = (
  value: unknown
): { action: ClinicalAIAction; provider: ClinicalAIProvider; model?: string | null } | null => {
  if (!value || typeof value !== 'object') return null;

  const request = value as AdminAIProviderTestRequest;
  if (
    typeof request.action !== 'string' ||
    typeof request.provider !== 'string' ||
    !SUPPORTED_ACTIONS.has(request.action as ClinicalAIAction) ||
    !SUPPORTED_PROVIDERS.has(request.provider as ClinicalAIProvider)
  ) {
    return null;
  }

  return {
    action: request.action as ClinicalAIAction,
    provider: request.provider as ClinicalAIProvider,
    model: typeof request.model === 'string' && request.model.trim() ? request.model.trim() : null,
  };
};

export const handler = async (event: NetlifyEventLike) => {
  const requestOrigin = getRequestOrigin(event);
  const corsHeaders = buildCorsHeaders(requestOrigin, {
    allowedHeaders: 'Content-Type, Authorization, Accept',
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
    return buildJsonResponse(405, { error: 'Method not allowed' }, { requestOrigin });
  }

  const authorizationHeader =
    typeof event.headers?.authorization === 'string'
      ? event.headers.authorization
      : typeof event.headers?.Authorization === 'string'
        ? event.headers.Authorization
        : undefined;

  try {
    extractBearerToken(authorizationHeader);
    const { db } = getFirebaseServer();
    await authorizeRoleRequest(db, authorizationHeader, ADMIN_AI_PROVIDER_TEST_ALLOWED_ROLES);

    const body = parseJsonBody<unknown>(event.body);
    if (!body.ok) {
      return buildJsonResponse(400, { ok: false, message: body.error }, { requestOrigin });
    }

    const request = parseProviderTestRequest(body.value);
    if (!request) {
      return buildJsonResponse(
        400,
        { ok: false, message: 'Invalid AI provider test request' },
        { requestOrigin }
      );
    }

    const providerConfig = resolveClinicalAIProviderConfig({
      action: request.action,
      routingConfig: {
        actions: {
          [request.action]: {
            enabled: true,
            provider: request.provider,
            model: request.model,
          },
        },
      },
    });

    if (!providerConfig) {
      return buildJsonResponse(
        200,
        {
          ok: false,
          provider: request.provider,
          message: 'AI not configured',
        },
        { requestOrigin }
      );
    }

    await generateClinicalAIText({
      config: providerConfig,
      systemPrompt:
        'You are running a health check for a configured AI provider. Return a brief OK response.',
      userPrompt: 'Return only OK. No clinical, patient, or administrative data is included.',
      temperature: 0,
      maxTokens: 16,
    });

    return buildJsonResponse(
      200,
      {
        ok: true,
        provider: providerConfig.provider,
        model: providerConfig.model,
        message: 'Provider test succeeded',
      },
      { requestOrigin }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI provider test failed';
    const statusCode =
      message.includes('Access denied') || message.includes('no email claim')
        ? 403
        : message.includes('Authorization') || message.includes('bearer token')
          ? 401
          : 502;

    return buildJsonResponse(
      statusCode,
      {
        ok: false,
        message: statusCode === 502 ? 'AI provider test failed' : message,
      },
      { requestOrigin }
    );
  }
};
