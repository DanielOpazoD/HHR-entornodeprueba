import { createHash } from 'node:crypto';
import { getFirebaseServer } from './lib/firebase-server';
import { authorizeRoleRequest } from './lib/firebase-auth';
import {
  buildJsonResponse,
  getHeader,
  getClientIp,
  getRequestOrigin,
  isOriginAllowed,
  isRateLimited,
  parseJsonBody,
  type NetlifyEventLike,
} from './lib/http';

const ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
  'editor',
  'viewer',
]);
const ACTIONS: Record<string, { method: string; path: string }> = {
  status: { method: 'GET', path: '/session' },
  pair: { method: 'POST', path: '/pair' },
  connect: { method: 'POST', path: '/session/connect' },
  disconnect: { method: 'POST', path: '/session' },
  search: { method: 'POST', path: '/search' },
  pdf: { method: 'GET', path: '/pdf' },
};
interface Dependencies {
  getFirebaseServer: typeof getFirebaseServer;
  authorizeRoleRequest: typeof authorizeRoleRequest;
}
export const createExalabProxyHandler =
  (dependencies: Dependencies = { getFirebaseServer, authorizeRoleRequest }) =>
  async (event: NetlifyEventLike) => {
    const params = new URLSearchParams(event.rawQuery || '');
    const action = params.get('action') || '';
    const target = ACTIONS[action];
    const origin = getRequestOrigin(event);
    // The connection page has only a five-minute, single-use pairing capability.
    // It can attach a session, never read a patient or choose an operator.
    const extensionConnect =
      action === 'connect' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin || '');
    const requestOrigin = extensionConnect ? undefined : origin;
    const json = (
      status: number,
      data: unknown
    ): { statusCode: number; headers: Record<string, string>; body: string } =>
      buildJsonResponse(status, data, {
        requestOrigin,
        headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
      });
    if (!extensionConnect && !isOriginAllowed(origin))
      return json(403, { success: false, error: 'Origen no autorizado.' });
    if (event.httpMethod === 'OPTIONS') return json(200, {});
    if (!target || event.httpMethod !== target.method)
      return json(400, { success: false, error: 'Acción o método no válido.' });
    if (
      isRateLimited(`exalab:${action === 'status' ? 'status:' : ''}${getClientIp(event)}`, {
        maxPerWindow: action === 'status' ? 60 : 20,
        windowMs: 60_000,
      })
    ) {
      return json(429, { success: false, error: 'Demasiadas consultas. Espera un minuto.' });
    }
    if (event.isBase64Encoded || (event.body?.length || 0) > 65_536)
      return json(400, { success: false, error: 'Solicitud no válida.' });
    let owner: string | undefined;
    if (action !== 'connect') {
      try {
        const { db } = dependencies.getFirebaseServer();
        const actor = await dependencies.authorizeRoleRequest(
          db,
          getHeader(event.headers, 'authorization'),
          ROLES
        );
        if (!actor.token?.sub || !actor.token.aud)
          return json(401, { success: false, error: 'Inicia sesión en HHR.' });
        owner = createHash('sha256')
          .update(
            JSON.stringify([
              actor.token.aud,
              actor.token.sub,
              process.env.ACTIVE_HOSPITAL_ID || 'hanga_roa',
            ])
          )
          .digest('hex');
      } catch {
        return json(403, { success: false, error: 'No autorizado para consultar laboratorio.' });
      }
    }
    const configured = process.env.SYSLAB_PROXY_URL || process.env.VITE_SYSLAB_API_URL;
    if (!configured || !process.env.SYSLAB_API_TOKEN)
      return json(503, { success: false, error: 'El puente de laboratorio no está configurado.' });
    try {
      const base = new URL(configured);
      if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash)
        throw new Error('configuration');
      const url = new URL(`${base.href.replace(/\/+$/, '')}/api/exalab${target.path}`);
      if (action === 'pdf') {
        const link = params.get('link');
        if (!link || !link.startsWith('hhr-exalab://report/') || link.length > 8192)
          return json(400, { success: false, error: 'Informe no válido.' });
        url.searchParams.set('link', link);
      }
      let body: string | undefined;
      if (action === 'search' || action === 'connect') {
        if (!getHeader(event.headers, 'content-type')?.toLowerCase().startsWith('application/json'))
          return json(400, { success: false, error: 'Se requiere JSON.' });
        const parsed = parseJsonBody<Record<string, unknown>>(event.body);
        if (!parsed.ok) return json(400, { success: false, error: 'Solicitud JSON no válida.' });
        body = JSON.stringify(
          action === 'search'
            ? { rut: parsed.value.rut, from: parsed.value.from, to: parsed.value.to }
            : {
                pair: parsed.value.pair,
                session: parsed.value.session,
                // A silent reconnection names the consenting account; the bridge refuses another one's pair.
                ...(typeof parsed.value.expectedOwner === 'string' &&
                /^[a-f0-9]{16}$/.test(parsed.value.expectedOwner)
                  ? { expectedOwner: parsed.value.expectedOwner }
                  : {}),
              }
        );
      }
      const response = await fetch(url.href, {
        method: action === 'disconnect' ? 'DELETE' : target.method,
        headers: {
          Authorization: `Bearer ${process.env.SYSLAB_API_TOKEN}`,
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
          ...(owner ? { 'X-HHR-Lab-Owner': owner } : {}),
        },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(45_000),
      });
      const chunks: Uint8Array[] = [];
      let length = 0;
      const reader = response.body?.getReader();
      if (!reader) throw new Error('empty');
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > 4 * 1024 * 1024) {
            await reader.cancel();
            throw new Error('size');
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = Buffer.concat(chunks);
      if (action === 'pdf' && response.ok) {
        if (
          !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')) ||
          !bytes.subarray(-2048).includes(Buffer.from('%%EOF'))
        )
          throw new Error('pdf');
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
          },
          body: bytes.toString('base64'),
          isBase64Encoded: true,
        };
      }
      const data: unknown = JSON.parse(bytes.toString());
      if (
        !data ||
        typeof data !== 'object' ||
        !('success' in data) ||
        typeof data.success !== 'boolean'
      )
        throw new Error('shape');
      return json(
        [200, 400, 401, 409, 429, 503].includes(response.status) ? response.status : 502,
        data
      );
    } catch {
      return json(502, {
        success: false,
        error: 'No se pudo conectar con Exalab a través del Mac mini. Vuelve a intentar.',
      });
    }
  };
export const handler = createExalabProxyHandler();
