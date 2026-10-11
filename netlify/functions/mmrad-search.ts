/**
 * mmrad-search Netlify Function
 *
 * Authenticates with the MMRAD RIS (ris.mmrad.cl) Liferay portal,
 * searches for patient radiology exams by RUT, and returns structured
 * exam data (name, date, modality, status, PDF/DICOM links).
 *
 * Login flow (Liferay-specific):
 *   1. GET /web/guest/home → extract form action URL (contains jsessionid)
 *   2. POST credentials to that action URL → 302 redirect
 *   3. Follow redirect chain → lands on /group/hhangaroa (authenticated dashboard)
 *   4. Extract search form action URL from the dashboard HTML
 *   5. POST patient RUT to the search form → HTML with exam results
 */

import { getFirebaseServer } from './lib/firebase-server';
import { authorizeRoleRequest, extractBearerToken } from './lib/firebase-auth';
import { invokeWithTelemetry } from './lib/observability';
import {
  buildCorsHeaders,
  buildJsonResponse,
  buildTooManyRequestsResponse,
  getClientIp,
  getRequestOrigin,
  isOriginAllowed,
  isRateLimited,
  type NetlifyEventLike,
} from './lib/http';
import { parseMMRADReportSections } from '../../src/services/radiology/mmradReportSupport';

const MMRAD_BASE_URL = 'https://ris.mmrad.cl';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const MMRAD_ALLOWED_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
  'editor',
  'viewer',
]);

const resolveMmradAuthorizationErrorMessage = (message: string): string => {
  if (message.includes("Access denied for role 'unauthorized'")) {
    return 'Acceso denegado para MMRAD. Tu correo no tiene un rol autorizado en config/roles o la sesión local no corresponde al entorno actual.';
  }

  const deniedRoleMatch = message.match(/Access denied for role '([^']+)'/);
  if (deniedRoleMatch) {
    return `Acceso denegado para MMRAD. El rol '${deniedRoleMatch[1]}' no tiene permiso para consultar radiología.`;
  }

  return message;
};

interface MMRADSearchDependencies {
  getFirebaseServer: typeof getFirebaseServer;
  authorizeRoleRequest: typeof authorizeRoleRequest;
  extractBearerToken: typeof extractBearerToken;
}

interface MMRADExam {
  nombre_examen: string;
  fecha_examen: string;
  fecha_asignacion: string;
  mod: string;
  estado: string;
  pdf_url: string | null;
  dicom_url: string | null;
  informe_html_url: string | null;
  portal_web_receipt_url: string | null;
  report: ReturnType<typeof parseMMRADReportSections>;
}

const buildPdfProxyResponse = async (pdfUrl: string, cookies: string, requestOrigin?: string) => {
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

const buildPortalReceiptProxyResponse = async (
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

/** Convert ISO date (YYYY-MM-DD) to RIS format (DD/MM/YYYY). */
const isoToRisDate = (isoDate: string): string => {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
};

/** Validate ISO date format. */
const isValidIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Decode common HTML entities in Liferay-generated markup. */
const decodeHtmlEntities = (text: string): string =>
  text
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');

const getCredentials = () => {
  const username = process.env.MMRAD_USERNAME?.trim();
  const password = process.env.MMRAD_PASSWORD?.trim();

  if (!username || !password) {
    throw new Error(
      'MMRAD credentials not configured. Set MMRAD_USERNAME and MMRAD_PASSWORD environment variables.'
    );
  }

  return { username, password };
};

/** Collect all Set-Cookie headers from a fetch Response. */
const collectSetCookies = (response: Response): string[] => {
  const dynamicHeaders = response.headers as unknown as {
    getSetCookie?: () => string[];
    raw?: () => Record<string, string[]>;
  };
  if ('getSetCookie' in response.headers && typeof dynamicHeaders.getSetCookie === 'function') {
    return dynamicHeaders.getSetCookie();
  }
  const raw = dynamicHeaders.raw?.();
  if (raw?.['set-cookie']) return raw['set-cookie'];
  const single = response.headers.get('set-cookie');
  return single ? [single] : [];
};

/** Merge cookies: new Set-Cookie values override existing ones by name. */
const mergeCookies = (existing: string, newSetCookies: string[]): string => {
  const map = new Map<string, string>();
  for (const part of existing.split('; ').filter(Boolean)) {
    const [name] = part.split('=');
    if (name) map.set(name.trim(), part.trim());
  }
  for (const sc of newSetCookies) {
    const nameValue = sc.split(';')[0]?.trim();
    if (nameValue) {
      const [name] = nameValue.split('=');
      if (name) map.set(name.trim(), nameValue);
    }
  }
  return Array.from(map.values()).join('; ');
};

/** Extract the Liferay login form action URL from the home page HTML. */
const extractLoginActionUrl = (html: string): string | null => {
  const match = html.match(/action="(https:\/\/ris\.mmrad\.cl[^"]*login%2Flogin[^"]*)"/);
  return match?.[1] ?? null;
};

/** Extract the exam search form action URL from the authenticated dashboard HTML. */
const extractSearchActionUrl = (html: string): string | null => {
  const match = html.match(/action="(https:\/\/ris\.mmrad\.cl[^"]*examenportlet[^"]*)"/);
  return match?.[1] ?? null;
};

const fetchWithHeaders = async (
  url: string,
  options: RequestInit = {},
  redirects = 0
): Promise<Response> => {
  const safeUrl = normalizeMmradUrl(url);
  if (!safeUrl) throw new Error('Destino MMRAD no permitido');

  const response = await fetch(safeUrl, {
    ...options,
    redirect: 'manual',
    headers: { 'User-Agent': USER_AGENT, ...(options.headers as Record<string, string>) },
  });
  if (options.redirect === 'manual' || ![301, 302, 303, 307, 308].includes(response.status)) {
    return response;
  }

  const location = response.headers.get('location');
  if (!location || redirects >= 5) throw new Error('Redirección MMRAD no válida');
  const nextUrl = new URL(location, safeUrl).href;
  const nextOptions = { ...options };
  const method = (options.method || 'GET').toUpperCase();
  if (
    (response.status === 303 && method !== 'HEAD') ||
    ([301, 302].includes(response.status) && method === 'POST')
  ) {
    nextOptions.method = 'GET';
    delete nextOptions.body;
    const headers = { ...(options.headers as Record<string, string>) };
    delete headers['Content-Type'];
    delete headers['content-type'];
    nextOptions.headers = headers;
  }
  return fetchWithHeaders(nextUrl, nextOptions, redirects + 1);
};

const decodeResponseHtml = async (
  response: Response,
  encoding: string = 'utf-8'
): Promise<string> => {
  const dynamicResponse = response as unknown as {
    arrayBuffer?: () => Promise<ArrayBuffer>;
    text: () => Promise<string>;
  };

  if (typeof dynamicResponse.arrayBuffer === 'function') {
    const buffer = await dynamicResponse.arrayBuffer();
    return new TextDecoder(encoding).decode(buffer);
  }

  return dynamicResponse.text();
};

const normalizeMmradUrl = (rawUrl: string | null | undefined): string | null => {
  if (!rawUrl) return null;

  let normalized = rawUrl.trim();
  const javascriptWindowOpenMatch = normalized.match(/window\.open\(['"]([^'"]+)['"]/i);
  if (javascriptWindowOpenMatch?.[1]) {
    normalized = javascriptWindowOpenMatch[1];
  }

  try {
    const url = new URL(normalized, MMRAD_BASE_URL);
    if (url.origin !== MMRAD_BASE_URL || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
};

const extractActionUrlFromFragment = (fragment: string): string | null => {
  const windowOpenMatch = fragment.match(/window\.open\(['"]([^'"]+)['"]/i);
  if (windowOpenMatch?.[1]) {
    return normalizeMmradUrl(windowOpenMatch[1]);
  }

  const hrefMatch = fragment.match(/href=["']([^"']+)["']/i);
  if (hrefMatch?.[1]) {
    return normalizeMmradUrl(hrefMatch[1]);
  }

  return null;
};

const extractActionUrlByLabel = (rowHtml: string, label: string): string | null => {
  const decoded = decodeHtmlEntities(rowHtml);
  const labelIndex = decoded.toLocaleLowerCase('es-CL').indexOf(label.toLocaleLowerCase('es-CL'));
  if (labelIndex < 0) {
    return null;
  }

  const anchorStart = decoded.lastIndexOf('<a', labelIndex);
  const anchorEnd = decoded.indexOf('</a>', labelIndex);
  if (anchorStart >= 0 && anchorEnd > labelIndex) {
    const anchorUrl = extractActionUrlFromFragment(decoded.slice(anchorStart, anchorEnd + 4));
    if (anchorUrl) {
      return anchorUrl;
    }
  }

  const nearbyFragment = decoded.slice(Math.max(0, labelIndex - 700), labelIndex + 700);
  return extractActionUrlFromFragment(nearbyFragment);
};

interface LoginResult {
  cookies: string;
  searchActionUrl: string | null;
}

const loginToMMRAD = async (): Promise<LoginResult> => {
  const { username, password } = getCredentials();
  let cookies = '';

  // Step 1: GET home page → extract login form action + initial cookies
  const step1 = await fetchWithHeaders(`${MMRAD_BASE_URL}/web/guest/home`, { redirect: 'manual' });
  cookies = mergeCookies(cookies, collectSetCookies(step1));
  const step1Html = await step1.text();
  const loginActionUrl = extractLoginActionUrl(step1Html);

  if (!loginActionUrl) {
    return { cookies, searchActionUrl: null };
  }

  // Step 2: POST login credentials
  const step2 = await fetchWithHeaders(loginActionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
    body: new URLSearchParams({
      _58_login: username,
      _58_password: password,
      _58_redirect: '/web/guest/home',
      _58_rememberMe: 'false',
    }).toString(),
    redirect: 'manual',
  });
  cookies = mergeCookies(cookies, collectSetCookies(step2));
  const redirect1 = step2.headers.get('location') || '';

  // Step 3: Follow first redirect
  if (redirect1) {
    const url3 = redirect1.startsWith('http') ? redirect1 : `${MMRAD_BASE_URL}${redirect1}`;
    const step3 = await fetchWithHeaders(url3, {
      redirect: 'manual',
      headers: { Cookie: cookies },
    });
    cookies = mergeCookies(cookies, collectSetCookies(step3));
    const redirect2 = step3.headers.get('location') || '';

    // Step 4: Follow second redirect (typically /group/hhangaroa)
    if (redirect2) {
      const url4 = redirect2.startsWith('http') ? redirect2 : `${MMRAD_BASE_URL}${redirect2}`;
      const step4 = await fetchWithHeaders(url4, { headers: { Cookie: cookies } });
      cookies = mergeCookies(cookies, collectSetCookies(step4));
      const dashboardHtml = await step4.text();
      const searchActionUrl = extractSearchActionUrl(dashboardHtml);
      return { cookies, searchActionUrl };
    }
  }

  return { cookies, searchActionUrl: null };
};

const searchExams = async (
  rut: string,
  cookies: string,
  searchActionUrl: string,
  dateFrom?: string,
  dateTo?: string
): Promise<MMRADExam[]> => {
  const params: Record<string, string> = { idpaciente: rut };

  // Add date filters in DD/MM/YYYY format (RIS expects this, not ISO)
  if (dateFrom && isValidIsoDate(dateFrom)) {
    params.fechaexamendesde = isoToRisDate(dateFrom);
  }
  if (dateTo && isValidIsoDate(dateTo)) {
    params.fechaexamenhasta = isoToRisDate(dateTo);
  }

  const response = await fetchWithHeaders(searchActionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookies,
      Referer: `${MMRAD_BASE_URL}/group/hhangaroa`,
    },
    body: new URLSearchParams(params).toString(),
  });

  const html = await response.text();
  const exams = parseExamsFromHTML(html);
  return hydrateStructuredCtReports(exams, cookies);
};

const fetchReportSections = async (
  reportUrl: string,
  cookies: string
): Promise<ReturnType<typeof parseMMRADReportSections>> => {
  const response = await fetchWithHeaders(reportUrl, {
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
    return null;
  }

  const html = await decodeResponseHtml(response, 'latin1');
  return parseMMRADReportSections(html);
};

const hydrateStructuredCtReports = async (
  exams: MMRADExam[],
  cookies: string
): Promise<MMRADExam[]> => {
  const hydrated = await Promise.all(
    exams.map(async exam => {
      const modality = (exam.mod || '').trim().toUpperCase();
      if (modality !== 'CT' || !exam.informe_html_url) {
        return exam;
      }

      try {
        const report = await fetchReportSections(exam.informe_html_url, cookies);
        return { ...exam, report };
      } catch {
        return exam;
      }
    })
  );

  return hydrated;
};

const parseExamsFromHTML = (html: string): MMRADExam[] => {
  // Decode HTML entities first so regex can match quotes properly
  const decoded = decodeHtmlEntities(html);
  const exams: MMRADExam[] = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(decoded)) !== null) {
    const rowHtml = rowMatch[1];
    if (!rowHtml || !rowHtml.includes('Acciones')) continue;

    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const tds: string[] = [];
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      tds.push(
        tdMatch[1]
          .replace(/<[^>]+>/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      );
    }

    if (tds.length < 10) continue;

    // PDF download link (direct download)
    const pdfMatch = rowHtml.match(/href="([^"]*informePDF[^"]*)"/i);
    let pdfUrl: string | null = pdfMatch?.[1] ?? null;
    pdfUrl = normalizeMmradUrl(pdfUrl);

    // DICOM HTML5 viewer link — uses UtilServlet?a=3 (image viewer)
    // Pattern: window.open('/ingrad-ris-informehtml/UtilServlet?a=3&u=...&idexamen=...&idprestacion=...')
    let dicomUrl: string | null = null;
    const dicomMatch = rowHtml.match(
      /window\.open\('(\/ingrad-ris-informehtml\/UtilServlet\?a=3[^']+)'/
    );
    if (dicomMatch?.[1]) {
      dicomUrl = `${MMRAD_BASE_URL}${dicomMatch[1]}`;
    }

    let informeHtmlUrl: string | null = null;
    const reportUrlPatterns = [
      /href="([^"]*(?:informehtml|UtilServlet\?a=1)[^"]*)"/i,
      /window\.open\('([^']*(?:informehtml|UtilServlet\?a=1)[^']*)'/i,
    ];

    for (const pattern of reportUrlPatterns) {
      const match = rowHtml.match(pattern);
      if (match?.[1]) {
        informeHtmlUrl = normalizeMmradUrl(match[1]);
        break;
      }
    }

    if (!informeHtmlUrl) {
      const javascriptMatch = rowHtml.match(
        /javascript:window\.open\('([^']*(?:informehtml|UtilServlet\?a=1)[^']*)'\);?/i
      );
      if (javascriptMatch?.[1]) {
        informeHtmlUrl = normalizeMmradUrl(javascriptMatch[1]);
      }
    }

    const portalWebReceiptUrl = extractActionUrlByLabel(rowHtml, 'Comprobante Portal Web paciente');

    exams.push({
      nombre_examen: tds[10] || '',
      fecha_examen: tds[7] || '',
      fecha_asignacion: tds[6] || '',
      mod: tds[11] || '',
      estado: tds[13] || '',
      pdf_url: pdfUrl,
      dicom_url: dicomUrl,
      informe_html_url: informeHtmlUrl,
      portal_web_receipt_url: portalWebReceiptUrl,
      report: null,
    });
  }

  return exams;
};

export const createMMRADSearchHandler = (
  dependencies: MMRADSearchDependencies = {
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
    if (isRateLimited(clientIp, { maxPerWindow: 10, windowMs: 60_000 })) {
      return buildTooManyRequestsResponse(requestOrigin);
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
      await dependencies.authorizeRoleRequest(db, authorizationHeader, MMRAD_ALLOWED_ROLES);
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : 'No autorizado para consultar radiología.';
      const statusCode =
        rawMessage.includes('Access denied') || rawMessage.includes('no email claim') ? 403 : 401;
      const message =
        statusCode === 403 ? resolveMmradAuthorizationErrorMessage(rawMessage) : rawMessage;
      return buildJsonResponse(statusCode, { error: message }, { requestOrigin });
    }

    const queryParams = new URLSearchParams(event.rawQuery || '');
    const action = queryParams.get('action');

    if (action === 'pdf') {
      const pdfUrl = normalizeMmradUrl(queryParams.get('link'));
      if (!pdfUrl) {
        return buildJsonResponse(
          400,
          { error: 'link MMRAD es requerido o no permitido' },
          { requestOrigin }
        );
      }

      try {
        return await invokeWithTelemetry({
          service: 'mmrad',
          operation: 'pdf_proxy',
          timeoutMs: 20_000,
          maxAttempts: 2,
          db,
          hospitalId: process.env.ACTIVE_HOSPITAL_ID || 'hanga_roa',
          context: { action: 'pdf' },
          fn: async () => {
            const { cookies } = await loginToMMRAD();
            return buildPdfProxyResponse(pdfUrl, cookies, requestOrigin);
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido';
        return buildJsonResponse(500, { error: message }, { requestOrigin });
      }
    }

    if (action === 'portalReceipt') {
      const receiptUrl = normalizeMmradUrl(queryParams.get('link'));
      if (!receiptUrl) {
        return buildJsonResponse(
          400,
          { error: 'link MMRAD es requerido o no permitido' },
          { requestOrigin }
        );
      }

      try {
        return await invokeWithTelemetry({
          service: 'mmrad',
          operation: 'portal_receipt_proxy',
          timeoutMs: 20_000,
          maxAttempts: 2,
          db,
          hospitalId: process.env.ACTIVE_HOSPITAL_ID || 'hanga_roa',
          context: { action: 'portalReceipt' },
          fn: async () => {
            const { cookies } = await loginToMMRAD();
            return buildPortalReceiptProxyResponse(receiptUrl, cookies, requestOrigin);
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido';
        return buildJsonResponse(500, { error: message }, { requestOrigin });
      }
    }

    const rut = queryParams.get('rut');
    if (!rut) {
      return buildJsonResponse(400, { error: 'RUT es requerido' }, { requestOrigin });
    }

    const cleanRut = rut.replace(/\./g, '').trim();

    try {
      return await invokeWithTelemetry({
        service: 'mmrad',
        operation: 'search_exams',
        timeoutMs: 20_000,
        maxAttempts: 2,
        db,
        hospitalId: process.env.ACTIVE_HOSPITAL_ID || 'hanga_roa',
        context: {
          action: 'search',
          hasFromFilter: Boolean(queryParams.get('from')),
          hasToFilter: Boolean(queryParams.get('to')),
        },
        fn: async () => {
          const { cookies, searchActionUrl } = await loginToMMRAD();

          if (!searchActionUrl) {
            return buildJsonResponse(
              200,
              {
                rut: cleanRut,
                examenes: [],
              },
              { requestOrigin }
            );
          }

          const examenes = await searchExams(
            cleanRut,
            cookies,
            searchActionUrl,
            queryParams.get('from') || undefined,
            queryParams.get('to') || undefined
          );

          return buildJsonResponse(
            200,
            {
              rut: cleanRut,
              examenes,
            },
            { requestOrigin }
          );
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      return buildJsonResponse(500, { error: message }, { requestOrigin });
    }
  };
};

export const handler = createMMRADSearchHandler();
