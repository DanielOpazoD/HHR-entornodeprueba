const { onRequest } = require('firebase-functions/v2/https');
const { resolveFirebaseProjectId } = require('../runtime/runtimeConfig');
const { normalizeEmail } = require('../auth/authEmailUtils');
const {
  InstanceTicketExpiredError,
  UNIVERSITAS_ORIGIN,
  universitasInstanceRequest,
  verifyUniversitasTicket,
} = require('./mmradInstanceAccess');

/**
 * Brings one MMRAD original that `mmrad-dicom` (Netlify) cannot carry. MMRAD's radiographs are
 * uncompressed originals of 23-25 MB (measured 2026-11-03); a Netlify response carries ~4.5 MB.
 * Cloud Run answers up to 32 MiB, and `visorammym.mmrad.cl` answers from Chile but not from North
 * America, so this runs in Santiago. It accepts only an instance ticket that `mmrad-dicom` issued
 * for the Universitas viewer and fetches only that original from the fixed viewer host.
 */
const MAX_ORIGINAL_BYTES = 30_000_000;
const UPSTREAM_TIMEOUT_MS = 60_000;
const MAX_REQUEST_BYTES = 6000;
// Same roles as Netlify's MMRAD_ALLOWED_ROLES (mmrad-session.ts); the parity test keeps them equal.
const MMRAD_ALLOWED_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
  'editor',
  'viewer',
]);
// HHR's published sites and their deploy previews, as the Chrome extension lists them.
const ALLOWED_ORIGINS = new Set([
  'https://hhr-hospitalizados.app',
  'https://testinghhr.netlify.app',
  'https://hhr-entorno-prueba.netlify.app',
]);
const PREVIEW_ORIGIN =
  /^https:\/\/deploy-preview-[1-9]\d*--(?:testinghhr|hhr-entorno-prueba)\.netlify\.app$/;
const TRANSIENT_UPSTREAM = new Set([408, 429, 500, 502, 503, 504]);

const isOriginAllowed = origin => ALLOWED_ORIGINS.has(origin) || PREVIEW_ORIGIN.test(origin);

class BoundedResponseTooLargeError extends Error {}

const readBoundedBody = async (response, limit) => {
  if (!response.body) throw new Error('MMRAD no entregó el original.');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new BoundedResponseTooLargeError();
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks, length);
};

const retryAfterSeconds = value => {
  if (!value) return 0;
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
};

/** Per instance, like Netlify's quota; a radiograph study has a handful of originals. */
const createRateLimiter = (maxPerWindow = 60, windowMs = 60_000) => {
  const windows = new Map();
  return (key, now = Date.now()) => {
    for (const [stored, value] of windows)
      if (now - value.start >= windowMs) windows.delete(stored);
    const current = windows.get(key) ?? { start: now, count: 0 };
    current.count += 1;
    windows.set(key, current);
    return current.count > maxPerWindow;
  };
};

const createMmradDicomSantiagoHandler =
  ({
    verifyIdToken,
    resolveRoleForEmail,
    fetchImpl = (...args) => fetch(...args),
    isRateLimited = createRateLimiter(),
  }) =>
  async (req, res) => {
    const origin = req.get('origin');
    res.set({ Vary: 'Origin', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    const json = (status, payload, headers = {}) => {
      res.status(status).set(headers).json(payload);
    };
    const tooLarge = bytes =>
      json(413, {
        error: 'El original DICOM supera los 30 MB que admite esta conexión.',
        code: 'too-large',
        ...(bytes ? { bytes } : {}),
      });
    // Requests without Origin are not from a browser; authentication still applies to them.
    if (origin && !isOriginAllowed(origin)) return json(403, { error: 'Origin not allowed' });
    if (origin)
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Expose-Headers': 'Retry-After, Server-Timing',
      });
    if (req.method === 'OPTIONS') {
      res.set({
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
      });
      return res.status(204).end();
    }
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

    const authStart = performance.now();
    const [scheme, token] = String(req.get('authorization') || '')
      .trim()
      .split(/\s+/, 2);
    const unauthenticated = () =>
      json(401, { error: 'Se requiere una sesión con acceso a radiología.' });
    if (scheme !== 'Bearer' || !token) return unauthenticated();
    let decoded;
    try {
      decoded = await verifyIdToken(token);
    } catch {
      return unauthenticated();
    }
    const subject = typeof decoded?.sub === 'string' ? decoded.sub : '';
    const email = normalizeEmail(decoded?.email);
    if (!subject || !email) return unauthenticated();
    // The role checkUserRole returns (legacy aliases are already resolved there).
    let role;
    try {
      role = await resolveRoleForEmail(email, {
        auth: { uid: decoded.uid || subject, token: decoded },
      });
    } catch {
      return json(503, { error: 'No se pudo verificar el acceso a radiología. Reintenta.' });
    }
    if (!MMRAD_ALLOWED_ROLES.has(role))
      return json(403, { error: 'Se requiere una sesión con acceso a radiología.' });
    const authMs = performance.now() - authStart;

    const rawLength = Buffer.isBuffer(req.rawBody) ? req.rawBody.length : 0;
    const body = req.body;
    if (
      rawLength > MAX_REQUEST_BYTES ||
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      typeof body.ticket !== 'string'
    )
      return json(400, { error: 'Solicitud DICOM no válida.' });
    if (isRateLimited(subject))
      return json(
        429,
        { error: 'Demasiadas solicitudes. Reintenta en un minuto.' },
        {
          'Retry-After': '60',
        }
      );

    let ticket;
    let upstream;
    try {
      ticket = verifyUniversitasTicket(body.ticket, subject);
      upstream = universitasInstanceRequest(ticket);
    } catch (error) {
      // Only an authentic, expired ticket of this user gets a code: the viewer renews it silently.
      return json(403, {
        error: 'El acceso al estudio no es válido o venció. Vuelve a abrir el visor.',
        ...(error instanceof InstanceTicketExpiredError ? { code: 'ticket-expired' } : {}),
      });
    }

    // A browser that leaves (another series, closed viewer) stops the upstream transfer too.
    const departed = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) departed.abort();
    });
    let receivedHeaders = false;
    const upstreamStart = performance.now();
    try {
      const response = await fetchImpl(upstream.url, {
        redirect: 'error',
        signal: AbortSignal.any([departed.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
        headers: {
          Referer: `${UNIVERSITAS_ORIGIN}/`,
          Accept: 'application/dicom',
          Cookie: upstream.cookie,
        },
      });
      receivedHeaders = true;
      const upstreamHeadersMs = performance.now() - upstreamStart;
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        const transient = TRANSIENT_UPSTREAM.has(response.status);
        const retry = retryAfterSeconds(response.headers.get('retry-after'));
        return json(
          transient ? (response.status === 429 ? 429 : 503) : 422,
          { error: 'MMRAD no pudo entregar este original DICOM.' },
          retry ? { 'Retry-After': String(retry) } : {}
        );
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_ORIGINAL_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        return tooLarge(declared);
      }
      const bodyStart = performance.now();
      const bytes = await readBoundedBody(response, MAX_ORIGINAL_BYTES);
      const upstreamBodyMs = performance.now() - bodyStart;
      if (bytes.length < 132 || bytes.toString('latin1', 128, 132) !== 'DICM')
        return json(422, { error: 'MMRAD no entregó un original DICOM válido.' });
      res.status(200).set({
        'Content-Type': 'application/dicom',
        'Content-Length': String(bytes.length),
        'Server-Timing': [
          `auth;dur=${authMs.toFixed(1)}`,
          `upstream;dur=${(performance.now() - upstreamStart).toFixed(1)}`,
          `upstream_headers;dur=${upstreamHeadersMs.toFixed(1)}`,
          `upstream_body;dur=${upstreamBodyMs.toFixed(1)}`,
        ].join(', '),
      });
      return res.end(bytes);
    } catch (error) {
      if (error instanceof BoundedResponseTooLargeError) return tooLarge();
      if (departed.signal.aborted) return undefined;
      const transient =
        !receivedHeaders ||
        error instanceof TypeError ||
        ['AbortError', 'TimeoutError'].includes(error?.name);
      return json(transient ? 502 : 422, {
        error: 'No se pudo descargar el original DICOM desde MMRAD.',
      });
    }
  };

// Tickets, cookies, sessions, UIDs and exceptions never reach logs: every path answers itself.
const createMmradDicomSantiagoFunction = dependencies => {
  const handler = createMmradDicomSantiagoHandler(dependencies);
  return onRequest(
    {
      region: 'southamerica-west1',
      serviceAccount: `${resolveFirebaseProjectId()}@appspot.gserviceaccount.com`,
      secrets: ['MMRAD_PASSWORD'],
      // A 30 MB original is held twice at most while it is checked and sent; 4 at a time fit.
      memory: '1GiB',
      cpu: 1,
      concurrency: 4,
      minInstances: 0,
      maxInstances: 10,
      // 25 MB to Rapa Nui can take a while on a slow link; MMRAD itself has 60 s.
      timeoutSeconds: 180,
    },
    async (req, res) => {
      try {
        await handler(req, res);
      } catch {
        if (!res.headersSent)
          res.status(500).json({ error: 'No se pudo descargar el original DICOM.' });
      }
    }
  );
};

module.exports = {
  ALLOWED_ORIGINS,
  MAX_ORIGINAL_BYTES,
  MMRAD_ALLOWED_ROLES,
  createMmradDicomSantiagoFunction,
  createMmradDicomSantiagoHandler,
};
