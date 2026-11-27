import { readAuthorizationHeader } from './lib/authorization-header';
import { safeErrorMessage } from './lib/safe-error-message';
import { authorizeAdminAIRequest } from './lib/admin-ai-auth';
import { listClinicalAIProviderAvailability } from './lib/ai-provider';
import { SERVERLESS_ADMIN_ONLY_ROLES } from '../../src/shared/access/serverlessRoleAccess';
import {
  buildCorsPreflightResponse,
  buildJsonResponse,
  getRequestOrigin,
  isOriginAllowed,
  type NetlifyEventLike,
} from './lib/http';

const ADMIN_AI_PROVIDER_STATUS_ALLOWED_ROLES = SERVERLESS_ADMIN_ONLY_ROLES;

export const handler = async (event: NetlifyEventLike) => {
  const requestOrigin = getRequestOrigin(event);

  if (!isOriginAllowed(requestOrigin)) {
    return buildJsonResponse(403, { error: 'Origin not allowed' }, { requestOrigin });
  }

  if (event.httpMethod === 'OPTIONS') {
    return buildCorsPreflightResponse(requestOrigin, {
      allowedHeaders: 'Content-Type, Authorization, Accept',
      allowedMethods: 'GET,OPTIONS',
    });
  }

  if (event.httpMethod !== 'GET') {
    return buildJsonResponse(405, { error: 'Method not allowed' }, { requestOrigin });
  }

  const authorizationHeader = readAuthorizationHeader(event);

  try {
    await authorizeAdminAIRequest(authorizationHeader, ADMIN_AI_PROVIDER_STATUS_ALLOWED_ROLES);

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

    return buildJsonResponse(statusCode, { error: safeErrorMessage(message) }, { requestOrigin });
  }
};
