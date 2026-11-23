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

import { readAuthorizationHeader } from './lib/authorization-header';
import { safeErrorMessage } from './lib/safe-error-message';
import { getFirebaseServer } from './lib/firebase-server';
import { authorizeRoleRequest, extractBearerToken } from './lib/firebase-auth';
import { invokeWithTelemetry } from './lib/observability';
import { searchMistypedCheckDigitExams } from './lib/mmrad-check-digit-search';
import {
  buildJsonResponse,
  buildTooManyRequestsResponse,
  getClientIp,
  getRequestOrigin,
  isOriginAllowed,
  isRateLimited,
  type NetlifyEventLike,
} from './lib/http';
import {
  MMRAD_ALLOWED_ROLES,
  loginToMMRAD,
  normalizeMmradUrl,
  withMMRADSession,
} from './lib/mmrad-session';
import {
  buildPdfProxyResponse,
  buildPortalReceiptProxyResponse,
  resolveMmradAuthorizationErrorMessage,
} from './lib/mmrad-proxy-responses';
import { examKey, hydrateStructuredCtReports, searchExamRows } from './lib/mmrad-search-html';

interface MMRADSearchDependencies {
  getFirebaseServer: typeof getFirebaseServer;
  authorizeRoleRequest: typeof authorizeRoleRequest;
  extractBearerToken: typeof extractBearerToken;
}

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
    // Each patient search is two requests: the exact RUT and, in parallel, its mistyped check digits.
    if (isRateLimited(clientIp, { maxPerWindow: 20, windowMs: 60_000 })) {
      return buildTooManyRequestsResponse(requestOrigin);
    }

    if (event.httpMethod !== 'GET') {
      return buildJsonResponse(405, { error: 'Method not allowed' }, { requestOrigin });
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
    try {
      await dependencies.authorizeRoleRequest(db, authorizationHeader, MMRAD_ALLOWED_ROLES);
    } catch (error) {
      const rawMessage =
        error instanceof Error ? error.message : 'No autorizado para consultar radiología.';
      const statusCode =
        rawMessage.includes('Access denied') || rawMessage.includes('no email claim') ? 403 : 401;
      const message =
        statusCode === 403 ? resolveMmradAuthorizationErrorMessage(rawMessage) : rawMessage;
      return buildJsonResponse(statusCode, { error: safeErrorMessage(message) }, { requestOrigin });
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
          isFailureResult: result => result.statusCode >= 500 && result.statusCode < 600,
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
        return buildJsonResponse(500, { error: safeErrorMessage(message) }, { requestOrigin });
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
          isFailureResult: result => result.statusCode >= 500 && result.statusCode < 600,
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
        return buildJsonResponse(500, { error: safeErrorMessage(message) }, { requestOrigin });
      }
    }

    const rut = queryParams.get('rut');
    if (!rut) {
      return buildJsonResponse(400, { error: 'RUT es requerido' }, { requestOrigin });
    }

    const cleanRut = rut.replace(/\./g, '').trim();
    // The exact RUT answers in about 1.5 s; the ten other check digits, one by one, take about
    // 4.5 s more. The viewer asks for them in a second request that runs at the same time in its
    // own function instance and RIS session, and merges them when they arrive.
    const checkDigitOnly = action === 'check-digit';
    // Only with the census name: a mistyped check digit is accepted when the name matches.
    const patientName = (queryParams.get('name') || '').slice(0, 200);
    if (checkDigitOnly && !patientName.trim()) {
      return buildJsonResponse(400, { error: 'Nombre del paciente requerido' }, { requestOrigin });
    }

    try {
      return await invokeWithTelemetry({
        service: 'mmrad',
        operation: 'search_exams',
        timeoutMs: 20_000,
        maxAttempts: 2,
        db,
        hospitalId: process.env.ACTIVE_HOSPITAL_ID || 'hanga_roa',
        context: {
          action: checkDigitOnly ? 'check-digit' : 'search',
          hasFromFilter: Boolean(queryParams.get('from')),
          hasToFilter: Boolean(queryParams.get('to')),
        },
        fn: async () => {
          return withMMRADSession(async ({ cookies, searchActionUrl }) => {
            if (!searchActionUrl) {
              throw new Error('No se pudo iniciar sesión en MMRAD.');
            }

            const from = queryParams.get('from') || undefined;
            const to = queryParams.get('to') || undefined;
            const search = (patientId: string) =>
              searchExamRows(patientId, cookies, searchActionUrl, from, to);
            const exact = checkDigitOnly ? [] : (await search(cleanRut)).map(row => row.exam);
            const mistyped = patientName
              ? await searchMistypedCheckDigitExams({
                  rut: cleanRut,
                  patientName,
                  search,
                  key: examKey,
                })
              : null;
            const known = new Set(exact.map(examKey));
            const examenes = await hydrateStructuredCtReports(
              [...exact, ...(mistyped?.exams.filter(exam => !known.has(examKey(exam))) ?? [])],
              cookies
            );

            return buildJsonResponse(
              200,
              {
                rut: cleanRut,
                examenes,
                ...(mistyped
                  ? { check_digit_search: mistyped.complete ? 'complete' : 'partial' }
                  : {}),
              },
              { requestOrigin }
            );
          });
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      return buildJsonResponse(500, { error: safeErrorMessage(message) }, { requestOrigin });
    }
  };
};

export const handler = createMMRADSearchHandler();
