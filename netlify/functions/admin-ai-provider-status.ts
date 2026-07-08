import { getFirebaseServer } from './lib/firebase-server';
import { authorizeRoleRequest, extractBearerToken } from './lib/firebase-auth';
import { listClinicalAIProviderAvailability } from './lib/ai-provider';
import {
  buildCorsHeaders,
  buildJsonResponse,
  getRequestOrigin,
  isOriginAllowed,
  type NetlifyEventLike,
} from './lib/http';

const ADMIN_AI_PROVIDER_STATUS_ALLOWED_ROLES = new Set(['admin']);

export const handler = async (event: NetlifyEventLike) => {
  const requestOrigin = getRequestOrigin(event);
  const corsHeaders = buildCorsHeaders(requestOrigin, {
    allowedHeaders: 'Content-Type, Authorization, Accept',
    allowedMethods: 'GET,OPTIONS',
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

  if (event.httpMethod !== 'GET') {
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
    await authorizeRoleRequest(db, authorizationHeader, ADMIN_AI_PROVIDER_STATUS_ALLOWED_ROLES);

    return buildJsonResponse(
      200,
      {
        providers: listClinicalAIProviderAvailability().map(provider => ({
          provider: provider.provider,
          configured: provider.configured,
          model: provider.model,
        })),
      },
      { requestOrigin }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI provider status failed';
    const statusCode =
      message.includes('Access denied') || message.includes('no email claim')
        ? 403
        : message.includes('Authorization') || message.includes('bearer token')
          ? 401
          : 500;

    return buildJsonResponse(statusCode, { error: message }, { requestOrigin });
  }
};
