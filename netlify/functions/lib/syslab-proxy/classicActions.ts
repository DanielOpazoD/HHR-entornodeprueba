import { readResponseWithinLimit } from '../bounded-response';
import { buildJsonResponse, buildTextResponse, parseJsonBody } from '../http';
import {
  isAllowedLabLink,
  MAX_PDF_RESPONSE_BYTES,
  MAX_REQUEST_BODY_BYTES,
  NO_STORE_HEADERS,
  proxyFetch,
  readBoundedJson,
} from './upstream';

export const handleHealth = async (proxyUrl: string, requestOrigin?: string) => {
  try {
    const response = await proxyFetch(`${proxyUrl}/health`, { method: 'GET' });
    if (!response.ok) {
      return buildJsonResponse(
        200,
        { success: false, connected: false, status: response.status },
        { requestOrigin, headers: NO_STORE_HEADERS }
      );
    }

    const health = await readBoundedJson(response);
    const connected =
      typeof health === 'object' &&
      health !== null &&
      'connected' in health &&
      health.connected === true;
    return buildJsonResponse(
      200,
      { success: connected, connected, status: response.status },
      { requestOrigin, headers: NO_STORE_HEADERS }
    );
  } catch {
    return buildJsonResponse(
      200,
      {
        success: false,
        connected: false,
        error: 'El servidor de laboratorio no está disponible. Comprueba el Mac mini.',
      },
      { requestOrigin, headers: NO_STORE_HEADERS }
    );
  }
};

export const handleSearch = async (
  proxyUrl: string,
  params: URLSearchParams,
  requestOrigin?: string
) => {
  const rut = params.get('rut')?.trim();
  if (!rut || rut.length > 32) {
    return buildJsonResponse(
      400,
      { error: 'RUT es requerido' },
      { requestOrigin, headers: NO_STORE_HEADERS }
    );
  }

  const url = `${proxyUrl}/api/exams?rut=${encodeURIComponent(rut)}`;
  const response = await proxyFetch(url);
  const data = await readBoundedJson(response);

  return buildJsonResponse(response.status === 200 ? 200 : 502, data, {
    requestOrigin,
    headers: NO_STORE_HEADERS,
  });
};

export const handleDetails = async (
  proxyUrl: string,
  body: string | null | undefined,
  requestOrigin?: string
) => {
  if ((body?.length || 0) > MAX_REQUEST_BODY_BYTES) {
    return buildJsonResponse(
      400,
      { error: 'Solicitud inválida.' },
      { requestOrigin, headers: NO_STORE_HEADERS }
    );
  }

  const parsed = parseJsonBody<{ links: string[] }>(body);
  if (!parsed.ok) {
    return buildJsonResponse(
      400,
      { error: parsed.error },
      { requestOrigin, headers: NO_STORE_HEADERS }
    );
  }

  const { links } = parsed.value;
  if (
    !Array.isArray(links) ||
    links.length === 0 ||
    links.length > 3 ||
    links.some(link => typeof link !== 'string' || !isAllowedLabLink(link))
  ) {
    return buildJsonResponse(
      400,
      { error: 'Se requiere un array de links' },
      { requestOrigin, headers: NO_STORE_HEADERS }
    );
  }

  const url = `${proxyUrl}/api/exams/details`;
  const response = await proxyFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ links }),
  });
  const data = await readBoundedJson(response);

  return buildJsonResponse(response.status === 200 ? 200 : 502, data, {
    requestOrigin,
    headers: NO_STORE_HEADERS,
  });
};

export const handlePdf = async (
  proxyUrl: string,
  params: URLSearchParams,
  requestOrigin?: string
) => {
  const link = params.get('link');
  if (!link || !isAllowedLabLink(link)) {
    return buildJsonResponse(
      400,
      { error: 'link es requerido' },
      { requestOrigin, headers: NO_STORE_HEADERS }
    );
  }

  const url = `${proxyUrl}/api/exams/pdf?link=${encodeURIComponent(link)}`;
  const response = await proxyFetch(url);

  if (!response.ok) {
    return buildTextResponse(502, 'Error al obtener el PDF del servidor de laboratorio', {
      requestOrigin,
    });
  }

  const bytes = await readResponseWithinLimit(response, MAX_PDF_RESPONSE_BYTES);
  if (!bytes || bytes.subarray(0, 4).toString() !== '%PDF') {
    return buildTextResponse(502, 'El servidor no entregó un PDF válido de laboratorio.', {
      requestOrigin,
    });
  }
  const base64 = bytes.toString('base64');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'no-store',
    },
    body: base64,
    isBase64Encoded: true,
  };
};
