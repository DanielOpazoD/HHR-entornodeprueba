import { buildCorsHeaders, buildJsonResponse } from './http';
import { MMRAD_BASE_URL, decodeResponseHtml, fetchWithHeaders } from './mmrad-session';

export const resolveMmradAuthorizationErrorMessage = (message: string): string => {
  if (message.includes("Access denied for role 'unauthorized'")) {
    return 'Acceso denegado para MMRAD. Tu correo no tiene un rol autorizado en config/roles o la sesión local no corresponde al entorno actual.';
  }

  const deniedRoleMatch = message.match(/Access denied for role '([^']+)'/);
  if (deniedRoleMatch) {
    return `Acceso denegado para MMRAD. El rol '${deniedRoleMatch[1]}' no tiene permiso para consultar radiología.`;
  }

  return message;
};

export const buildPdfProxyResponse = async (
  pdfUrl: string,
  cookies: string,
  requestOrigin?: string
) => {
  const response = await fetchWithHeaders(pdfUrl, {
    headers: {
      Cookie: cookies,
      Referer: `${MMRAD_BASE_URL}/group/hhangaroa`,
    },
  });

  const isSuccessful =
    typeof response.ok === 'boolean'
      ? response.ok
      : response.status >= 200 && response.status < 400;

  if (!isSuccessful) {
    return buildJsonResponse(
      502,
      { error: 'Error al obtener el PDF desde MMRAD' },
      { requestOrigin }
    );
  }

  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');

  return {
    statusCode: 200,
    headers: {
      ...buildCorsHeaders(requestOrigin, {
        allowedHeaders: 'Content-Type, Authorization, Accept',
        allowedMethods: 'GET,OPTIONS',
      }),
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="mmrad-report.pdf"',
      'Cache-Control': 'private, max-age=300',
    },
    body: base64,
    isBase64Encoded: true,
  };
};

export const buildPortalReceiptProxyResponse = async (
  receiptUrl: string,
  cookies: string,
  requestOrigin?: string
) => {
  const response = await fetchWithHeaders(receiptUrl, {
    headers: {
      Cookie: cookies,
      Referer: `${MMRAD_BASE_URL}/group/hhangaroa`,
    },
  });

  const isSuccessful =
    typeof response.ok === 'boolean'
      ? response.ok
      : response.status >= 200 && response.status < 400;

  if (!isSuccessful) {
    return buildJsonResponse(
      502,
      { error: 'Error al obtener el comprobante portal desde MMRAD' },
      { requestOrigin }
    );
  }

  const html = await decodeResponseHtml(response, 'latin1');

  return {
    statusCode: 200,
    headers: {
      ...buildCorsHeaders(requestOrigin, {
        allowedHeaders: 'Content-Type, Authorization, Accept',
        allowedMethods: 'GET,OPTIONS',
      }),
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
    },
    body: html,
  };
};
