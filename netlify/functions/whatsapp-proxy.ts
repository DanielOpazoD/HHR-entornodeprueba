import {
  buildCorsHeaders,
  buildJsonResponse,
  buildTooManyRequestsResponse,
  getClientIp,
  getHeader,
  getRequestOrigin,
  isOriginAllowed,
  isRateLimited,
  type NetlifyEventLike,
} from './lib/http';
import { getFirebaseServer } from './lib/firebase-server';
import { authorizeRoleRequest, extractBearerToken } from './lib/firebase-auth';
import { invokeWithTelemetry } from './lib/observability';

const PROXY_ROUTE_PREFIX = '/.netlify/functions/whatsapp-proxy';
const WHATSAPP_ALLOWED_ROLES = new Set(['admin', 'nurse_hospital']);

const resolveBotBaseUrl = (): string =>
  (process.env.WHATSAPP_BOT_URL || process.env.WHATSAPP_BOT_SERVER || '').replace(/\/$/, '');

const getPathSuffix = (path: string | undefined) => {
  if (!path) return '/';
  const suffix = path.startsWith(PROXY_ROUTE_PREFIX) ? path.slice(PROXY_ROUTE_PREFIX.length) : path;
  return suffix.startsWith('/') ? suffix : `/${suffix}`;
};

interface WhatsAppProxyDependencies {
  getFirebaseServer: typeof getFirebaseServer;
  authorizeRoleRequest: typeof authorizeRoleRequest;
  extractBearerToken: typeof extractBearerToken;
  fetch: typeof fetch;
}

export const createWhatsAppProxyHandler =
  (
    dependencies: WhatsAppProxyDependencies = {
      getFirebaseServer,
      authorizeRoleRequest,
      extractBearerToken,
      fetch,
    }
  ) =>
  async (event: NetlifyEventLike) => {
    const requestOrigin = getRequestOrigin(event);
    const corsHeaders = buildCorsHeaders(requestOrigin, {
      allowedHeaders: 'Content-Type, Authorization',
      allowedMethods: 'GET,POST,OPTIONS',
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

    // Rate limit only the actual request, not the CORS preflight.
    const clientIp = getClientIp(event);
    if (isRateLimited(clientIp, { maxPerWindow: 15, windowMs: 60_000 })) {
      return buildTooManyRequestsResponse(requestOrigin);
    }

    const botBaseUrl = resolveBotBaseUrl();
    if (!botBaseUrl) {
      return buildJsonResponse(
        500,
        { error: 'Missing WHATSAPP_BOT_URL environment variable' },
        { requestOrigin }
      );
    }

    const targetPath = getPathSuffix(event.path);
    const query = event.rawQuery ? `?${event.rawQuery}` : '';
    const targetUrl = `${botBaseUrl}${targetPath}${query}`;

    try {
      const authorizationHeader =
        typeof event.headers?.authorization === 'string'
          ? event.headers.authorization
          : typeof event.headers?.Authorization === 'string'
            ? event.headers.Authorization
            : undefined;

      try {
        dependencies.extractBearerToken(authorizationHeader);
      } catch (error) {
        return buildJsonResponse(
          401,
          {
            error:
              error instanceof Error
                ? error.message
                : 'Authentication required for WhatsApp proxy.',
          },
          { requestOrigin }
        );
      }

      const { db } = dependencies.getFirebaseServer();
      try {
        await dependencies.authorizeRoleRequest(db, authorizationHeader, WHATSAPP_ALLOWED_ROLES);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'WhatsApp authorization failed.';
        const statusCode =
          message.includes('Access denied') || message.includes('no email claim') ? 403 : 401;

        return buildJsonResponse(statusCode, { error: message }, { requestOrigin });
      }

      const headers: Record<string, string> = {};
      const contentType = getHeader(event.headers, 'content-type');
      if (contentType) {
        headers['Content-Type'] = contentType;
      }

      if (authorizationHeader) {
        headers.Authorization = authorizationHeader;
      }

      const init: RequestInit = {
        method: event.httpMethod,
        headers,
      };

      if (event.body && event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD') {
        init.body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
      }

      const controller = new AbortController();
      const { response, text } = await invokeWithTelemetry({
        service: 'whatsapp',
        operation: `${event.httpMethod} ${targetPath}`,
        timeoutMs: 8_000,
        maxAttempts: 1,
        db,
        hospitalId: process.env.ACTIVE_HOSPITAL_ID || 'hanga_roa',
        context: {
          method: event.httpMethod,
          path: targetPath,
        },
        fn: async () => {
          const response = await dependencies.fetch(targetUrl, {
            ...init,
            signal: controller.signal,
          });
          const text = await response.text();
          return { response, text };
        },
      }).catch((error: unknown) => {
        controller.abort();
        throw error;
      });
      const responseContentType = response.headers.get('content-type') || 'application/json';

      return {
        statusCode: response.status,
        headers: {
          ...corsHeaders,
          'Content-Type': responseContentType,
        },
        body: text,
      };
    } catch (error: unknown) {
      console.error('WhatsApp proxy error', error);
      return buildJsonResponse(
        502,
        {
          error: 'Failed to reach WhatsApp bot server',
          details: error instanceof Error ? error.message : String(error),
        },
        { requestOrigin }
      );
    }
  };

export const handler = createWhatsAppProxyHandler();
