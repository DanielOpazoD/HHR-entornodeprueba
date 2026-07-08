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
import {
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

const TIMEOUT_MS = 60_000; // 60s — PDF parsing can be slow
const DEFAULT_TELEMETRY_TIMEOUT_MS = 15_000;
const DETAILS_TELEMETRY_TIMEOUT_MS = 55_000;
const SYSLAB_ALLOWED_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
  'editor',
  'viewer',
]);

interface SyslabProxyDependencies {
  getFirebaseServer: typeof getFirebaseServer;
  authorizeRoleRequest: typeof authorizeRoleRequest;
  extractBearerToken: typeof extractBearerToken;
}

const getProxyUrl = (): string | null =>
  process.env.SYSLAB_PROXY_URL?.replace(/\/+$/, '') ||
  process.env.VITE_SYSLAB_API_URL?.replace(/\/+$/, '') ||
  null;

export const resolveSyslabTelemetryOptions = (
  action: 'search' | 'details' | 'pdf'
): { timeoutMs: number; maxAttempts: number } => ({
  timeoutMs: action === 'details' ? DETAILS_TELEMETRY_TIMEOUT_MS : DEFAULT_TELEMETRY_TIMEOUT_MS,
  maxAttempts: action === 'details' ? 1 : 3,
});

const proxyFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = {
      ...(options.headers as Record<string, string>),
      // Skip ngrok free-tier browser interstitial warning page
      'ngrok-skip-browser-warning': 'true',
      'User-Agent': 'HHR-Netlify-Function',
    };
    const response = await fetch(url, { ...options, headers, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeout);
  }
};

/* ── Health check ──────────────────────────────────────────────────── */

const handleHealth = async (proxyUrl: string, requestOrigin?: string) => {
  try {
    const response = await proxyFetch(`${proxyUrl}/health`, { method: 'GET' });
    if (!response.ok) {
      return buildJsonResponse(
        503,
        { success: false, connected: false, status: response.status },
        { requestOrigin }
      );
    }

    return buildJsonResponse(
      200,
      { success: true, connected: true, status: response.status },
      { requestOrigin }
    );
  } catch (error) {
    return buildJsonResponse(
      503,
      {
        success: false,
        connected: false,
        error: error instanceof Error ? error.message : 'Syslab unavailable',
      },
      { requestOrigin }
    );
  }
};

/* ── Search exams by RUT ─────────────────────────────────────────────── */

const handleSearch = async (proxyUrl: string, params: URLSearchParams, requestOrigin?: string) => {
  const rut = params.get('rut');
  if (!rut) {
    return buildJsonResponse(400, { error: 'RUT es requerido' }, { requestOrigin });
  }

  const url = `${proxyUrl}/api/exams?rut=${encodeURIComponent(rut)}`;
  const response = await proxyFetch(url);
  const data = await response.json();

  return buildJsonResponse(response.status === 200 ? 200 : 502, data, { requestOrigin });
};

/* ── Fetch exam details (PDF parsing) ────────────────────────────────── */

const handleDetails = async (
  proxyUrl: string,
  body: string | null | undefined,
  requestOrigin?: string
) => {
  const parsed = parseJsonBody<{ links: string[] }>(body);
  if (!parsed.ok) {
    return buildJsonResponse(400, { error: parsed.error }, { requestOrigin });
  }

  const { links } = parsed.value;
  if (!Array.isArray(links) || links.length === 0) {
    return buildJsonResponse(400, { error: 'Se requiere un array de links' }, { requestOrigin });
  }

  const url = `${proxyUrl}/api/exams/details`;
  const response = await proxyFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ links }),
  });
  const data = await response.json();

  return buildJsonResponse(response.status === 200 ? 200 : 502, data, { requestOrigin });
};

/* ── Proxy PDF for inline viewing ────────────────────────────────────── */

const handlePdf = async (proxyUrl: string, params: URLSearchParams, requestOrigin?: string) => {
  const link = params.get('link');
  if (!link) {
    return buildJsonResponse(400, { error: 'link es requerido' }, { requestOrigin });
  }

  const url = `${proxyUrl}/api/exams/pdf?link=${encodeURIComponent(link)}`;
  const response = await proxyFetch(url);

  if (!response.ok) {
    return buildTextResponse(502, 'Error al obtener el PDF del servidor de laboratorio', {
      requestOrigin,
    });
  }

  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'private, max-age=300',
    },
    body: base64,
    isBase64Encoded: true,
  };
};

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
      return buildJsonResponse(200, {}, { requestOrigin });
    }

    // Rate limit only the actual request, not the CORS preflight.
    const clientIp = getClientIp(event);
    if (isRateLimited(clientIp, { maxPerWindow: 20, windowMs: 60_000 })) {
      return buildTooManyRequestsResponse(requestOrigin);
    }

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
        { error: error instanceof Error ? error.message : 'Authentication required.' },
        { requestOrigin }
      );
    }

    const { db } = dependencies.getFirebaseServer();
    try {
      await dependencies.authorizeRoleRequest(db, authorizationHeader, SYSLAB_ALLOWED_ROLES);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'No autorizado para consultar laboratorio.';
      const statusCode =
        message.includes('Access denied') || message.includes('no email claim') ? 403 : 401;
      return buildJsonResponse(statusCode, { error: message }, { requestOrigin });
    }

    const proxyUrl = getProxyUrl();
    if (!proxyUrl) {
      return buildJsonResponse(
        503,
        {
          success: false,
          error:
            'El servicio de laboratorio no está configurado. ' +
            'Configure la variable SYSLAB_PROXY_URL o VITE_SYSLAB_API_URL.',
        },
        { requestOrigin }
      );
    }

    const params = new URLSearchParams(event.rawQuery || '');
    const action = params.get('action');

    try {
      if (action !== 'health' && action !== 'search' && action !== 'details' && action !== 'pdf') {
        return buildJsonResponse(
          400,
          { error: 'Acción no válida. Use: health, search, details, pdf' },
          { requestOrigin }
        );
      }

      if (action === 'health') {
        return handleHealth(proxyUrl, requestOrigin);
      }

      const telemetryOptions = resolveSyslabTelemetryOptions(action);

      return await invokeWithTelemetry({
        service: 'syslab',
        operation: action,
        timeoutMs: telemetryOptions.timeoutMs,
        // search/pdf are idempotent GETs, details posts links but parsing is deterministic
        maxAttempts: telemetryOptions.maxAttempts,
        db,
        hospitalId: process.env.ACTIVE_HOSPITAL_ID || 'hanga_roa',
        context: { action },
        fn: () => {
          if (action === 'search') return handleSearch(proxyUrl, params, requestOrigin);
          if (action === 'details') return handleDetails(proxyUrl, event.body, requestOrigin);
          return handlePdf(proxyUrl, params, requestOrigin);
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Error de conexión con el laboratorio';
      const isTimeout = error instanceof Error && error.name === 'AbortError';
      return buildJsonResponse(
        isTimeout ? 504 : 502,
        {
          success: false,
          error: isTimeout ? 'Timeout: el servidor de laboratorio no respondió a tiempo' : message,
        },
        { requestOrigin }
      );
    }
  };
};

export const handler = createSyslabProxyHandler();
