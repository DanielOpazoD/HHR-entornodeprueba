import { readAuthorizationHeader } from './lib/authorization-header';
import { safeErrorMessage } from './lib/safe-error-message';
/**
 * syslab-proxy Netlify Function
 *
 * Server-side proxy that forwards lab requests to the hospital's Express
 * proxy (API-laboratorioHHR) exposed via a public tunnel (e.g. Cloudflare
 * Tunnel, ngrok). This avoids CSP and CORS issues in production.
 *
 * Environment variable required:
 *   SYSLAB_PROXY_URL — Public URL of the Express proxy
 *                       (e.g. "https://lab-hhr.example.com")
 *
 * Local fallback:
 *   VITE_SYSLAB_API_URL — Used by `netlify dev` when serving the built app locally
 *                         and no public proxy URL is configured.
 *
 * Supported actions (via `action` query parameter):
 *   - health:  GET  /health  (checks upstream availability)
 *   - search:  GET  /api/exams?rut=<rut>
 *   - details: POST /api/exams/details  (body: { links: string[] })
 *   - pdf:     GET  /api/exams/pdf?link=<url>  (returns raw PDF bytes)
 */

import { getFirebaseServer } from './lib/firebase-server';
import { authorizeRoleRequest, extractBearerToken } from './lib/firebase-auth';
import { invokeWithTelemetry } from './lib/observability';
import { SERVERLESS_ALL_LOGIN_ROLES } from '../../src/shared/access/serverlessRoleAccess';
import {
  buildCorsPreflightResponse,
  buildJsonResponse,
  buildTooManyRequestsResponse,
  getClientIp,
  getRequestOrigin,
  isOriginAllowed,
  isRateLimited,
  type NetlifyEventLike,
} from './lib/http';
import {
  handleDetails,
  handleHealth,
  handlePdf,
  handleSearch,
} from './lib/syslab-proxy/classicActions';
import {
  buildSyslabJobOwner,
  handleJobAction,
  isJobProgressReadAction,
  JOB_ACTIONS,
} from './lib/syslab-proxy/jobActions';
import { getProxyUrl, isTimeoutError, NO_STORE_HEADERS } from './lib/syslab-proxy/upstream';

const TELEMETRY_TIMEOUT_MS = 55_000;
const TELEMETRY_MAX_ATTEMPTS = 1;
const SYSLAB_ALLOWED_ROLES = SERVERLESS_ALL_LOGIN_ROLES;

interface SyslabProxyDependencies {
  getFirebaseServer: typeof getFirebaseServer;
  authorizeRoleRequest: typeof authorizeRoleRequest;
  extractBearerToken: typeof extractBearerToken;
}

/* ── Handler ─────────────────────────────────────────────────────────── */

export const createSyslabProxyHandler = (
  dependencies: SyslabProxyDependencies = {
    getFirebaseServer,
    authorizeRoleRequest,
    extractBearerToken,
  }
) => {
  return async (event: NetlifyEventLike) => {
    const requestOrigin = getRequestOrigin(event);

    if (!isOriginAllowed(requestOrigin)) {
      return buildJsonResponse(403, { error: 'Origin not allowed' }, { requestOrigin });
    }

    if (event.httpMethod === 'OPTIONS') {
      return buildCorsPreflightResponse(requestOrigin);
    }

    const params = new URLSearchParams(event.rawQuery || '');
    const action = params.get('action');
    const isJobRead = isJobProgressReadAction(action);
    // Progress polling has its own bounded budget; it must not exhaust clinical searches.
    const clientIp = getClientIp(event);
    if (
      isRateLimited(isJobRead ? `syslab-progress:${clientIp}` : clientIp, {
        maxPerWindow: isJobRead ? 60 : 20,
        windowMs: 60_000,
      })
    ) {
      return buildTooManyRequestsResponse(requestOrigin);
    }

    const authorizationHeader = readAuthorizationHeader(event);

    try {
      dependencies.extractBearerToken(authorizationHeader);
    } catch (error) {
      return buildJsonResponse(
        401,
        { error: safeErrorMessage(error, 'Authentication required.') },
        { requestOrigin }
      );
    }

    const { db } = dependencies.getFirebaseServer();
    let actor: Awaited<ReturnType<typeof authorizeRoleRequest>>;
    try {
      actor = await dependencies.authorizeRoleRequest(
        db,
        authorizationHeader,
        SYSLAB_ALLOWED_ROLES
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No autorizado para consultar laboratorio.';
      const statusCode =
        message.includes('Access denied') || message.includes('no email claim') ? 403 : 401;
      return buildJsonResponse(statusCode, { error: safeErrorMessage(message) }, { requestOrigin });
    }

    const proxyUrl = getProxyUrl();
    if (!proxyUrl) {
      const error =
        'El servicio de laboratorio no está configurado. ' +
        'Configure la variable SYSLAB_PROXY_URL o VITE_SYSLAB_API_URL.';
      // A health check answered: disconnected is its result, not a failed request.
      return action === 'health'
        ? buildJsonResponse(200, { success: false, connected: false, error }, { requestOrigin })
        : buildJsonResponse(503, { success: false, error }, { requestOrigin });
    }

    if (!process.env.SYSLAB_API_TOKEN && /^https:\/\//.test(proxyUrl)) {
      const error = 'Falta configurar la conexión segura con el servidor de laboratorio.';
      return buildJsonResponse(
        action === 'health' ? 200 : 503,
        { success: false, connected: false, error },
        { requestOrigin }
      );
    }

    try {
      if (action && JOB_ACTIONS.has(action)) {
        if (!actor.token?.sub || !actor.token?.aud) {
          return buildJsonResponse(
            401,
            { error: 'Sesión de operador requerida.' },
            { requestOrigin, headers: NO_STORE_HEADERS }
          );
        }
        const owner = buildSyslabJobOwner(
          actor.token.aud,
          actor.token.sub,
          process.env.ACTIVE_HOSPITAL_ID || 'hanga_roa'
        );
        return await handleJobAction(proxyUrl, action, params, event, owner, requestOrigin);
      }
      if (action !== 'health' && action !== 'search' && action !== 'details' && action !== 'pdf') {
        return buildJsonResponse(
          400,
          { error: 'Acción no válida. Use: health, search, details, pdf' },
          { requestOrigin, headers: NO_STORE_HEADERS }
        );
      }

      const expectedMethod = action === 'details' ? 'POST' : 'GET';
      if (event.httpMethod !== expectedMethod) {
        return buildJsonResponse(
          405,
          { error: 'Método no permitido.' },
          { requestOrigin, headers: NO_STORE_HEADERS }
        );
      }

      if (action === 'health') {
        return handleHealth(proxyUrl, requestOrigin);
      }

      return await invokeWithTelemetry({
        service: 'syslab',
        operation: action,
        timeoutMs: TELEMETRY_TIMEOUT_MS,
        // search/pdf are idempotent GETs, details posts links but parsing is deterministic
        maxAttempts: TELEMETRY_MAX_ATTEMPTS,
        isFailureResult: result => result.statusCode >= 500 && result.statusCode < 600,
        hospitalId: process.env.ACTIVE_HOSPITAL_ID || 'hanga_roa',
        context: { action },
        fn: () => {
          if (action === 'search') return handleSearch(proxyUrl, params, requestOrigin);
          if (action === 'details') return handleDetails(proxyUrl, event.body, requestOrigin);
          return handlePdf(proxyUrl, params, requestOrigin);
        },
      });
    } catch (error) {
      const message = 'Error de conexión con el servidor de laboratorio. Comprueba el Mac mini.';
      const isTimeout = isTimeoutError(error);
      return buildJsonResponse(
        isTimeout ? 504 : 502,
        {
          success: false,
          error: isTimeout ? 'Timeout: el servidor de laboratorio no respondió a tiempo' : message,
        },
        { requestOrigin, headers: NO_STORE_HEADERS }
      );
    }
  };
};

export const handler = createSyslabProxyHandler();
