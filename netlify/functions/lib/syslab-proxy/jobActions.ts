import { createHash } from 'node:crypto';
import { buildJsonResponse, parseJsonBody, type NetlifyEventLike } from '../http';
import { MAX_REQUEST_BODY_BYTES, NO_STORE_HEADERS, proxyFetch, readBoundedJson } from './upstream';

const ALLOWED_JOB_STATUSES = new Set([200, 202, 400, 401, 404, 409, 429, 503]);

export const JOB_ACTIONS = new Set([
  'job-create',
  'job-status',
  'job-result',
  'job-cancel',
  'job-retry',
  'census-state',
  'census-review',
]);

export const isJobProgressReadAction = (action: string | null): boolean =>
  action === 'job-status' || action === 'job-result' || action === 'census-state';

export const buildSyslabJobOwner = (aud: string, sub: string, hospitalId: string): string =>
  createHash('sha256')
    .update(JSON.stringify([aud, sub, hospitalId]))
    .digest('hex');

export const handleJobAction = async (
  proxyUrl: string,
  action: string,
  params: URLSearchParams,
  event: NetlifyEventLike,
  owner: string,
  requestOrigin?: string
) => {
  const read = action === 'job-status' || action === 'job-result';
  if (event.httpMethod !== (read ? 'GET' : 'POST')) {
    return buildJsonResponse(
      405,
      { error: 'Método no permitido.' },
      { requestOrigin, headers: NO_STORE_HEADERS }
    );
  }
  if (!read && (event.isBase64Encoded || (event.body?.length || 0) > MAX_REQUEST_BODY_BYTES)) {
    return buildJsonResponse(
      400,
      { error: 'Solicitud no válida.' },
      { requestOrigin, headers: NO_STORE_HEADERS }
    );
  }
  let path: string;
  let payload: unknown;
  if (read || action === 'job-cancel' || action === 'job-retry') {
    const id = params.get('id') || '';
    if (!/^[a-f0-9-]{36}$/i.test(id)) {
      return buildJsonResponse(
        400,
        { error: 'Trabajo no válido.' },
        { requestOrigin, headers: NO_STORE_HEADERS }
      );
    }
    const rawOffset = params.get('offset') ?? '0';
    if (action === 'job-result' && !/^\d{1,6}$/.test(rawOffset)) {
      return buildJsonResponse(
        400,
        { error: 'Desplazamiento no válido.' },
        { requestOrigin, headers: NO_STORE_HEADERS }
      );
    }
    path = `/api/jobs/${id}${action === 'job-result' ? `/result?offset=${encodeURIComponent(rawOffset)}` : read ? '' : action === 'job-cancel' ? '/cancel' : '/retry'}`;
  } else {
    const parsed = parseJsonBody<Record<string, unknown>>(event.body);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') {
      return buildJsonResponse(
        400,
        { error: 'Solicitud no válida.' },
        { requestOrigin, headers: NO_STORE_HEADERS }
      );
    }
    payload = parsed.value;
    if (action === 'job-create') {
      const kind = parsed.value.kind;
      if (kind !== 'details' && kind !== 'census') {
        return buildJsonResponse(
          400,
          { error: 'Tipo no válido.' },
          { requestOrigin, headers: NO_STORE_HEADERS }
        );
      }
      path = `/api/jobs/${kind}`;
    } else {
      path = action === 'census-state' ? '/api/census/state' : '/api/census/review';
    }
  }
  const response = await proxyFetch(proxyUrl + path, {
    method: read ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-HHR-Lab-Owner': owner },
    ...(!read ? { body: JSON.stringify(payload || {}) } : {}),
  });
  const body = await readBoundedJson(response);
  const status = ALLOWED_JOB_STATUSES.has(response.status) ? response.status : 502;
  return buildJsonResponse(status, body, { requestOrigin, headers: NO_STORE_HEADERS });
};
