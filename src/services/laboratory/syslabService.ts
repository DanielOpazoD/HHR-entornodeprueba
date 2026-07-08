/**
 * @module syslabService
 * @description Client-side service for the Syslab laboratory API.
 *
 * In development, communicates directly with the Express proxy server
 * (API-laboratorioHHR) that runs on the hospital LAN and scrapes the
 * Syslab web portal via Playwright.
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

/** Return the Syslab Express server base URL from env or default. */
export const getSyslabBaseUrl = (): string =>
  import.meta.env.VITE_SYSLAB_API_URL || 'http://localhost:3000';

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

/**
 * Strip a Chilean RUT to its numeric body only (no dots, dash, or check digit).
 * Syslab requires this format for patient lookup.
 *
 * @param rut - RUT in any format (e.g., "12.345.678-9", "12345678-9", "12345678").
 * @returns Numeric body only (e.g., "12345678").
 */
export const cleanRutForSyslab = (rut: string): string =>
  rut.replace(/\./g, '').replace(/-.*$/, '').trim();

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
        const errorData = await response.json().catch(error => {
          syslabLogger.warn('Failed to parse Syslab error response body', error);
          return { error: 'Error de conexión' };
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
    const data = await response.json().catch(() => ({ connected: response.ok }));
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
 * In production, calls the Netlify Function `syslab-proxy?action=search`.
 * In development, calls the Express proxy directly.
 */
export const searchSyslabExams = async (rut: string): Promise<SyslabSearchResponse> => {
  const cleanRut = cleanRutForSyslab(rut);
  const authHeaders = await resolveCurrentUserAuthHeaders();

  const url = shouldUseNetlifyProxy()
    ? buildSyslabProxyUrl(`?action=search&rut=${encodeURIComponent(cleanRut)}`)
    : `${getSyslabBaseUrl()}/api/exams?rut=${encodeURIComponent(cleanRut)}`;

  try {
    const response = await fetchWithRetry(url, { headers: authHeaders });
    return await response.json();
  } catch (error) {
    syslabLogger.error('Syslab exam search failed', error);
    throw error;
  }
};

/**
 * Fetch structured lab results by parsing exam PDFs server-side.
 *
 * In production, calls the Netlify Function `syslab-proxy?action=details`.
 * In development, calls the Express proxy directly.
 */
export const fetchSyslabExamDetails = async (links: string[]): Promise<SyslabDetailsResponse> => {
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
    return await response.json();
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
 * In production, routes through the Netlify Function.
 * In development, uses the Express proxy directly.
 */
export const buildSyslabPdfUrl = (examLink: string): string =>
  shouldUseNetlifyProxy()
    ? buildSyslabProxyUrl(`?action=pdf&link=${encodeURIComponent(examLink)}`)
    : `${getSyslabBaseUrl()}/api/exams/pdf?link=${encodeURIComponent(examLink)}`;

const buildSyslabPdfBlob = async (examLink: string): Promise<Blob> => {
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
  const pdfBlob = await buildSyslabPdfBlob(examLink);
  return pdfBlob.arrayBuffer();
};

export const fetchSyslabPdfBlobUrl = async (examLink: string): Promise<string> => {
  const pdfBlob = await buildSyslabPdfBlob(examLink);
  return URL.createObjectURL(pdfBlob);
};
