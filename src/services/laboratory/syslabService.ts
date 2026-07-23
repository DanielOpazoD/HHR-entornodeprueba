/**
 * @module syslabService
 * @description Client-side service for the Syslab laboratory API.
 *
 * For patients in the HHR census, uses the extension's authenticated Syslab
 * session and searches by RUT body. It does not require a Ficha Médico session.
 *
 * In production (Netlify), calls the `syslab-proxy` Netlify Function
 * which forwards requests server-side to the Express proxy exposed via
 * a public tunnel.
 *
 * @example
 * ```ts
 * const result = await searchSyslabExams('12345678-9');
 * if (result.success) {
 *   console.log(result.data); // SyslabExamItem[]
 * }
 * ```
 */

import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';
import { createScopedLogger } from '@/services/utils/loggerScope';
import {
  fetchSyslabDetailsThroughExtension,
  cleanRutForSyslab,
  isSyslabExtensionLink,
  requestSyslabExtensionStatus,
  searchSyslabThroughExtension,
} from './syslabExtensionBridge';
export { cleanRutForSyslab };
import type { SyslabSearchResponse, SyslabDetailsResponse } from '@/types/domain/labExamTypes';

const syslabLogger = createScopedLogger('syslabService');

/** Default request timeout in milliseconds (30 seconds — Syslab scraping is slow). */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Maximum number of retry attempts for transient network failures. */
const MAX_RETRIES = 1;

const SYSLAB_DETAILS_BATCH_SIZE = 3;

const isNetlifyDevRuntime = (): boolean =>
  typeof globalThis.location !== 'undefined' &&
  /^(localhost|127\.0\.0\.1)$/.test(globalThis.location.hostname) &&
  globalThis.location.port === '8888';

/** True when requests should go through the Netlify Function proxy. */
const shouldUseNetlifyProxy = (): boolean => import.meta.env.PROD || isNetlifyDevRuntime();

/** Return the explicitly configured legacy Syslab Express proxy URL. */
export const getSyslabBaseUrl = (): string => {
  const configured = import.meta.env.VITE_SYSLAB_API_URL;
  return typeof configured === 'string' && configured !== 'undefined' && configured !== 'null'
    ? configured.trim()
    : '';
};

const buildSyslabProxyUrl = (query: string): string => `/.netlify/functions/syslab-proxy${query}`;

const isPlainViteLocalRuntime = (): boolean =>
  typeof globalThis.location !== 'undefined' &&
  /^(localhost|127\.0\.0\.1)$/.test(globalThis.location.hostname) &&
  !isNetlifyDevRuntime();

const isCrossOriginLocalhostUrl = (url: string): boolean => {
  if (typeof globalThis.location === 'undefined') {
    return false;
  }

  try {
    const target = new URL(url);
    return (
      /^(localhost|127\.0\.0\.1)$/.test(target.hostname) &&
      target.origin !== globalThis.location.origin
    );
  } catch {
    return false;
  }
};

const shouldSkipPlainViteLocalHealthCheck = (url: string): boolean =>
  isPlainViteLocalRuntime() &&
  isCrossOriginLocalhostUrl(url) &&
  import.meta.env.VITE_SYSLAB_ENABLE_DIRECT_LOCAL !== 'true';

const directWebTransportConfigured = (): boolean =>
  shouldUseNetlifyProxy() || Boolean(getSyslabBaseUrl());

const DIRECT_WEB_UNAVAILABLE_MESSAGE =
  'El acceso web directo a Syslab no está configurado. Activa la extensión Eloísa, recarga HHR y vuelve a intentar.';

const classifyHtmlResponse = (body: string, response: Response): Error => {
  const text = body.toLowerCase();
  if (
    response.redirected ||
    /(?:login|iniciar\s+sesión|usuario|contrase(?:ñ|n)a)/i.test(text.slice(0, 12_000))
  ) {
    return new Error(
      'Syslab solicitó iniciar sesión. Conéctalo desde el módulo Laboratorio de la extensión Eloísa y vuelve a intentar.'
    );
  }
  return new Error(
    'Syslab respondió con una página web en vez de datos. Usa el acceso LAB mediante la extensión Eloísa.'
  );
};

const readSyslabJson = async <T>(response: Response): Promise<T> => {
  const contentType = response.headers?.get?.('content-type')?.toLowerCase() || '';
  if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
    return Promise.reject(classifyHtmlResponse(await response.text(), response));
  }

  try {
    return (await response.json()) as T;
  } catch (error) {
    if (
      error instanceof SyntaxError &&
      /unexpected token\s*[<']|not valid json/i.test(error.message)
    ) {
      throw new Error(
        'Syslab respondió con un formato inesperado. Comprueba la extensión Eloísa y vuelve a intentar.'
      );
    }
    throw error;
  }
};

export interface SyslabConnectionStatus {
  available: boolean;
  message: string;
}

/**
 * Fetch with timeout and single retry for transient network failures.
 */
const fetchWithRetry = async (
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> => {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorData = await readSyslabJson<{ error?: string }>(response).catch(error => {
          syslabLogger.warn('Failed to parse Syslab error response body', error);
          return {
            error:
              error instanceof Error && error.message.startsWith('Syslab ')
                ? error.message
                : 'Error de conexión',
          };
        });
        throw new Error(errorData.error || `Error ${response.status}`);
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on non-network errors (4xx, 5xx already parsed above)
      if (lastError.name !== 'AbortError' && !lastError.message.includes('Failed to fetch')) {
        throw lastError;
      }

      if (attempt < MAX_RETRIES) {
        syslabLogger.warn(`Retry ${attempt + 1}/${MAX_RETRIES} for ${url}`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  throw lastError || new Error('Request failed');
};

export const checkSyslabConnection = async (): Promise<SyslabConnectionStatus> => {
  const extensionStatus = await requestSyslabExtensionStatus();
  if (extensionStatus.bridgeAvailable) {
    return {
      available: extensionStatus.connected,
      message: extensionStatus.connected
        ? 'Conectado mediante la extensión Eloísa'
        : extensionStatus.loginRequired
          ? 'Conecta Syslab desde el módulo Laboratorio de la extensión Eloísa.'
          : extensionStatus.message,
    };
  }

  if (!directWebTransportConfigured()) {
    return { available: false, message: DIRECT_WEB_UNAVAILABLE_MESSAGE };
  }

  const authHeaders = await resolveCurrentUserAuthHeaders();
  const url = shouldUseNetlifyProxy()
    ? buildSyslabProxyUrl('?action=health')
    : `${getSyslabBaseUrl()}/health`;

  if (shouldSkipPlainViteLocalHealthCheck(url)) {
    return {
      available: false,
      message:
        'Syslab local requiere netlify dev o VITE_SYSLAB_ENABLE_DIRECT_LOCAL=true para health checks cross-origin.',
    };
  }

  try {
    const response = await fetchWithRetry(url, { headers: authHeaders }, 5_000);
    const data = await readSyslabJson<{ connected?: boolean; success?: boolean; error?: string }>(
      response
    ).catch(error => ({
      connected: false,
      error: error instanceof Error ? error.message : 'Syslab no disponible',
    }));
    const connected = Boolean(data.connected ?? data.success ?? response.ok);

    return {
      available: connected,
      message: connected ? 'Conectado' : data.error || 'Syslab no disponible',
    };
  } catch (error) {
    syslabLogger.warn('Syslab health check failed', error);
    return {
      available: false,
      message: error instanceof Error ? error.message : 'Syslab no disponible',
    };
  }
};

/**
 * Search for patient lab exams in Syslab by RUT.
 *
 * Uses the extension whenever HHR provides a valid patient RUT.
 * The legacy Netlify/Express proxy is used only when explicitly configured.
 */
export const searchSyslabExams = async (rut: string): Promise<SyslabSearchResponse> => {
  const cleanRut = cleanRutForSyslab(rut);
  const extensionResult = await searchSyslabThroughExtension(rut);
  if (extensionResult.bridgeAvailable) {
    if (extensionResult.error) throw new Error(extensionResult.error);
    if (extensionResult.data) return extensionResult.data;
    throw new Error('La extensión Eloísa respondió sin resultados reconocibles.');
  }

  if (!directWebTransportConfigured()) {
    throw new Error(DIRECT_WEB_UNAVAILABLE_MESSAGE);
  }

  const authHeaders = await resolveCurrentUserAuthHeaders();

  const url = shouldUseNetlifyProxy()
    ? buildSyslabProxyUrl(`?action=search&rut=${encodeURIComponent(cleanRut)}`)
    : `${getSyslabBaseUrl()}/api/exams?rut=${encodeURIComponent(cleanRut)}`;

  try {
    const response = await fetchWithRetry(url, { headers: authHeaders });
    return await readSyslabJson<SyslabSearchResponse>(response);
  } catch (error) {
    syslabLogger.error('Syslab exam search failed', error);
    throw error;
  }
};

/**
 * Fetch structured lab results by parsing exam PDFs server-side.
 *
 * Extension search results remain bound to their opaque, expiring batch.
 * Legacy web links use the explicitly configured Netlify/Express proxy.
 */
export const fetchSyslabExamDetails = async (links: string[]): Promise<SyslabDetailsResponse> => {
  const extensionLinks = links.filter(isSyslabExtensionLink);
  if (extensionLinks.length > 0) {
    if (extensionLinks.length !== links.length) {
      throw new Error(
        'La selección mezcla búsquedas de laboratorio incompatibles. Actualiza el visor.'
      );
    }
    return fetchSyslabDetailsThroughExtension(links);
  }

  if (!directWebTransportConfigured()) throw new Error(DIRECT_WEB_UNAVAILABLE_MESSAGE);

  const authHeaders = await resolveCurrentUserAuthHeaders();
  const url = shouldUseNetlifyProxy()
    ? buildSyslabProxyUrl('?action=details')
    : `${getSyslabBaseUrl()}/api/exams/details`;

  const fetchDetailsBatch = async (batchLinks: string[]): Promise<SyslabDetailsResponse> => {
    const response = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ links: batchLinks }),
      },
      60_000 // 60s timeout for PDF parsing
    );
    return await readSyslabJson<SyslabDetailsResponse>(response);
  };

  try {
    if (links.length <= SYSLAB_DETAILS_BATCH_SIZE) {
      return await fetchDetailsBatch(links);
    }

    const mergedData: SyslabDetailsResponse['data'] = [];

    for (let index = 0; index < links.length; index += SYSLAB_DETAILS_BATCH_SIZE) {
      const batch = links.slice(index, index + SYSLAB_DETAILS_BATCH_SIZE);
      const batchResponse = await fetchDetailsBatch(batch);

      if (!batchResponse.success) {
        return {
          success: false,
          data: mergedData,
          error: batchResponse.error || 'No se pudieron obtener todos los detalles de laboratorio.',
        };
      }

      mergedData.push(...batchResponse.data);
    }

    return { success: true, data: mergedData };
  } catch (error) {
    syslabLogger.error('Syslab exam details fetch failed', error);
    throw error;
  }
};

/**
 * Build a URL that proxies an exam PDF for inline viewing.
 *
 * Legacy web links route through the explicitly configured Netlify/Express proxy.
 * Extension links are opened by the secure extension viewer instead.
 */
export const buildSyslabPdfUrl = (examLink: string): string =>
  shouldUseNetlifyProxy()
    ? buildSyslabProxyUrl(`?action=pdf&link=${encodeURIComponent(examLink)}`)
    : `${getSyslabBaseUrl()}/api/exams/pdf?link=${encodeURIComponent(examLink)}`;

const buildSyslabPdfBlob = async (examLink: string): Promise<Blob> => {
  if (isSyslabExtensionLink(examLink)) {
    throw new Error('Este informe se abre de forma segura mediante la extensión Eloísa.');
  }

  if (!directWebTransportConfigured()) throw new Error(DIRECT_WEB_UNAVAILABLE_MESSAGE);

  const authHeaders = await resolveCurrentUserAuthHeaders();
  const response = await fetchWithRetry(
    buildSyslabPdfUrl(examLink),
    { headers: authHeaders },
    60_000
  );
  const buffer = await response.arrayBuffer();
  return new Blob([buffer], { type: 'application/pdf' });
};

export const fetchSyslabPdfArrayBuffer = async (examLink: string): Promise<ArrayBuffer> => {
  if (isSyslabExtensionLink(examLink)) {
    throw new Error('Este informe se abre de forma segura mediante la extensión Eloísa.');
  }
  const pdfBlob = await buildSyslabPdfBlob(examLink);
  return pdfBlob.arrayBuffer();
};

export const fetchSyslabPdfBlobUrl = async (examLink: string): Promise<string> => {
  const pdfBlob = await buildSyslabPdfBlob(examLink);
  return URL.createObjectURL(pdfBlob);
};
