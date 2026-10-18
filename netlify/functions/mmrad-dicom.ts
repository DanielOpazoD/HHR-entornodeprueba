import { getFirebaseServer } from './lib/firebase-server';
import { authorizeRoleRequest, extractBearerToken } from './lib/firebase-auth';
import {
  buildCorsHeaders,
  buildJsonResponse,
  getClientIp,
  getHeader,
  getRequestOrigin,
  isOriginAllowed,
  isRateLimited,
  buildTooManyRequestsResponse,
  parseJsonBody,
  type NetlifyEventLike,
} from './lib/http';
import { normalizeMmradUrl, MMRAD_ALLOWED_ROLES } from './lib/mmrad-session';
import {
  MMRAD_VIEWER,
  verifyInstanceTicket,
  instanceWadoUrl,
  readBoundedResponse,
} from './lib/mmrad-dicom-policy';
import { loadVendorStudyMetadata, normalizeVendorStudy } from './lib/mmrad-dicom-metadata';
import { normalizeDicomPatientId } from '../../src/services/radiology/dicomTypes';
import { isValidRut } from '../../src/utils/rutUtils';

interface Dependencies {
  authorizeRoleRequest: typeof authorizeRoleRequest;
  getFirebaseServer: typeof getFirebaseServer;
  loadVendorStudyMetadata: typeof loadVendorStudyMetadata;
}

export const createMMRADDicomHandler =
  (
    dependencies: Dependencies = {
      authorizeRoleRequest,
      getFirebaseServer,
      loadVendorStudyMetadata,
    }
  ) =>
  async (event: NetlifyEventLike) => {
    const requestOrigin = getRequestOrigin(event);
    const json = (status: number, payload: unknown) =>
      buildJsonResponse(status, payload, {
        requestOrigin,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      });
    if (!isOriginAllowed(requestOrigin)) return json(403, { error: 'Origin not allowed' });
    if (event.httpMethod === 'OPTIONS') return json(200, {});
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
    const authorization = getHeader(event.headers, 'authorization');
    let subject: string;
    try {
      extractBearerToken(authorization);
      const user = await dependencies.authorizeRoleRequest(
        dependencies.getFirebaseServer().db,
        authorization,
        MMRAD_ALLOWED_ROLES
      );
      if (!user.token.sub) throw new Error('Authentication required');
      subject = user.token.sub;
    } catch (error) {
      return json(error instanceof Error && error.message.includes('Access denied') ? 403 : 401, {
        error: 'Se requiere una sesión con acceso a radiología.',
      });
    }
    if (!event.body || event.body.length > 6000 || event.isBase64Encoded)
      return json(400, { error: 'Solicitud DICOM no válida.' });
    const parsed = parseJsonBody<Record<string, unknown>>(event.body);
    if (
      !parsed.ok ||
      !parsed.value ||
      typeof parsed.value !== 'object' ||
      Array.isArray(parsed.value)
    )
      return json(400, { error: 'Solicitud DICOM no válida.' });
    const body = parsed.value;
    if (body.action !== 'metadata' && body.action !== 'instance')
      return json(400, { error: 'Acción DICOM no válida.' });
    // Search retains its existing 10/min quota; slice traffic has its own bounded quota.
    if (
      isRateLimited(`mmrad-dicom:${body.action}:${subject}:${getClientIp(event)}`, {
        maxPerWindow: body.action === 'metadata' ? 10 : 1500,
        windowMs: 60_000,
      })
    )
      return buildTooManyRequestsResponse(requestOrigin);
    if (body.action === 'metadata') {
      const link = normalizeMmradUrl(typeof body.link === 'string' ? body.link : null);
      const patient = typeof body.patientId === 'string' ? body.patientId.trim() : '';
      const document = normalizeDicomPatientId(patient);
      if (
        !link ||
        !/^[0-9.kK\s-]{2,16}$/.test(patient) ||
        !/^\d{1,8}[\dK]$/.test(document) ||
        !isValidRut(document)
      )
        return json(400, { error: 'Estudio o paciente no válido.' });
      try {
        const { uid, metadata } = await dependencies.loadVendorStudyMetadata(
          link,
          AbortSignal.timeout(25_000)
        );
        return json(200, normalizeVendorStudy(metadata, uid, patient, subject));
      } catch {
        return json(502, {
          error:
            'No se pudo abrir el estudio o verificar su paciente en MMRAD. Vuelve a intentarlo o utiliza el visor externo.',
        });
      }
    }
    let ticket: ReturnType<typeof verifyInstanceTicket>;
    try {
      ticket = verifyInstanceTicket(body.ticket, subject);
    } catch {
      return json(403, {
        error: 'El acceso al estudio no es válido o venció. Vuelve a abrir el visor.',
      });
    }
    let receivedHeaders = false;
    const upstreamStart = performance.now();
    try {
      const response = await fetch(instanceWadoUrl(ticket), {
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
        headers: { Referer: `${MMRAD_VIEWER}/viewer/${ticket.study}`, Accept: 'application/dicom' },
      });
      receivedHeaders = true;
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        const transient = [408, 429, 500, 502, 503, 504].includes(response.status);
        const retry = response.headers.get('retry-after');
        const parsedRetry =
          retry && /^\d+$/.test(retry)
            ? Number(retry)
            : retry
              ? Math.ceil((Date.parse(retry) - Date.now()) / 1000)
              : 0;
        return buildJsonResponse(
          transient ? (response.status === 429 ? 429 : 503) : 422,
          { error: 'MMRAD no pudo entregar este original DICOM.' },
          {
            requestOrigin,
            headers: {
              'Cache-Control': 'no-store',
              ...(Number.isFinite(parsedRetry) && parsedRetry > 0
                ? { 'Retry-After': String(parsedRetry) }
                : {}),
            },
          }
        );
      }
      const bytes = await readBoundedResponse(response, 3_500_000);
      if (bytes.length < 132 || new TextDecoder().decode(bytes.subarray(128, 132)) !== 'DICM')
        throw new Error('Original DICOM no válido');
      return {
        statusCode: 200,
        headers: {
          ...buildCorsHeaders(requestOrigin, { allowedMethods: 'POST,OPTIONS' }),
          'Content-Type': 'application/dicom',
          'Server-Timing': `upstream;dur=${(performance.now() - upstreamStart).toFixed(1)}`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
        body: Buffer.from(bytes).toString('base64'),
        isBase64Encoded: true,
      };
    } catch (error) {
      const transient =
        !receivedHeaders ||
        error instanceof TypeError ||
        (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name));
      return json(transient ? 502 : 422, {
        error:
          'No se pudo descargar un original DICOM o supera el límite de la conexión (3,5 MB por archivo).',
      });
    }
  };

export const handler = createMMRADDicomHandler();
