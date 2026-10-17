export interface NetlifyHeaders {
  [key: string]: string | undefined;
}

export interface NetlifyEventLike {
  httpMethod: string;
  headers: NetlifyHeaders;
  body?: string | null;
  path?: string;
  rawQuery?: string;
  isBase64Encoded?: boolean;
  [key: string]: unknown;
}

const DEFAULT_ALLOWED_HEADERS = 'Content-Type, Authorization, Accept, X-User-Role';
const DEFAULT_ALLOWED_METHODS = 'GET,POST,OPTIONS';

const normalizeUrlOrigin = (value: string | undefined): string | null => {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

export const resolveAllowedOrigins = (): string[] =>
  [
    process.env.URL,
    process.env.DEPLOY_PRIME_URL,
    process.env.DEPLOY_URL,
    process.env.SITE_URL,
    process.env.APP_URL,
  ]
    .map(normalizeUrlOrigin)
    .filter((origin): origin is string => Boolean(origin));

const isNetlifyPreviewOriginAllowed = (requestOrigin?: string): boolean => {
  // DEPLOY_PRIME_URL is build-only. SITE_NAME is reserved by Netlify and exists
  // at function runtime, even when the site's main URL uses a custom domain.
  const match = requestOrigin?.match(
    /^https:\/\/deploy-preview-[1-9]\d*--([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.netlify\.app$/
  );
  return Boolean(match && match[0] === requestOrigin && match[1] === process.env.SITE_NAME);
};

const isLocalFunctionOriginAllowed = (requestOrigin?: string): boolean => {
  if (process.env.HHR_ALLOW_LOCAL_FUNCTION_ORIGINS !== 'true' || !requestOrigin) {
    return false;
  }

  try {
    const originUrl = new URL(requestOrigin);
    return (
      (originUrl.protocol === 'http:' || originUrl.protocol === 'https:') &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(originUrl.hostname)
    );
  } catch {
    return false;
  }
};

export const getHeader = (
  headers: NetlifyHeaders | undefined,
  headerName: string
): string | undefined => {
  if (!headers) return undefined;

  const exact = headers[headerName];
  if (typeof exact === 'string') return exact;

  const normalizedName = headerName.toLowerCase();
  const entry = Object.entries(headers).find(([key, value]) => {
    return typeof value === 'string' && key.toLowerCase() === normalizedName;
  });

  return entry?.[1];
};

export const getRequestOrigin = (event: Pick<NetlifyEventLike, 'headers'>): string | undefined =>
  getHeader(event.headers, 'origin');

export const isOriginAllowed = (requestOrigin?: string): boolean =>
  !requestOrigin ||
  resolveAllowedOrigins().includes(requestOrigin) ||
  isNetlifyPreviewOriginAllowed(requestOrigin) ||
  isLocalFunctionOriginAllowed(requestOrigin);

export const buildCorsHeaders = (
  requestOrigin?: string,
  options?: {
    allowedHeaders?: string;
    allowedMethods?: string;
    extraHeaders?: Record<string, string>;
  }
): Record<string, string> => {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': options?.allowedHeaders ?? DEFAULT_ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': options?.allowedMethods ?? DEFAULT_ALLOWED_METHODS,
    Vary: 'Origin',
    ...(options?.extraHeaders ?? {}),
  };

  if (requestOrigin && isOriginAllowed(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
  }

  return headers;
};

export const buildJsonResponse = (
  statusCode: number,
  payload: unknown,
  options?: {
    requestOrigin?: string;
    contentType?: string;
    headers?: Record<string, string>;
  }
) => ({
  statusCode,
  headers: {
    ...buildCorsHeaders(options?.requestOrigin, { extraHeaders: options?.headers }),
    'Content-Type': options?.contentType ?? 'application/json; charset=utf-8',
  },
  body: JSON.stringify(payload),
});

export const buildTextResponse = (
  statusCode: number,
  body: string,
  options?: {
    requestOrigin?: string;
    headers?: Record<string, string>;
  }
) => ({
  statusCode,
  headers: {
    ...buildCorsHeaders(options?.requestOrigin, { extraHeaders: options?.headers }),
    'Content-Type': 'text/plain; charset=utf-8',
  },
  body,
});

/* ── Client IP extraction ─────────────────────────────────────────────── */

export const getClientIp = (event: Pick<NetlifyEventLike, 'headers'>): string => {
  const h = event.headers;
  return (
    getHeader(h, 'x-nf-client-connection-ip') ||
    getHeader(h, 'x-forwarded-for')?.split(',')[0]?.trim() ||
    getHeader(h, 'client-ip') ||
    'unknown'
  );
};

/* ── Simple in-memory rate limiter (per function instance) ───────────── */

const rateBuckets = new Map<string, number[]>();

/**
 * Returns `true` if the caller has exceeded `maxPerWindow` requests
 * within the last `windowMs` milliseconds.
 */
export const isRateLimited = (
  ip: string,
  { maxPerWindow = 10, windowMs = 60_000 }: { maxPerWindow?: number; windowMs?: number } = {}
): boolean => {
  const now = Date.now();
  const hits = (rateBuckets.get(ip) || []).filter(t => now - t < windowMs);
  hits.push(now);
  rateBuckets.set(ip, hits);
  // Prevent unbounded Map growth: prune stale IPs periodically
  if (rateBuckets.size > 500) {
    for (const [key, timestamps] of rateBuckets) {
      if (timestamps.every(t => now - t >= windowMs)) rateBuckets.delete(key);
    }
  }
  return hits.length > maxPerWindow;
};

export const buildTooManyRequestsResponse = (requestOrigin?: string) =>
  buildJsonResponse(
    429,
    { error: 'Demasiadas solicitudes. Intente de nuevo en un minuto.' },
    { requestOrigin, headers: { 'Retry-After': '60' } }
  );

/* ── JSON body parser ────────────────────────────────────────────────── */

export const parseJsonBody = <T>(body: string | null | undefined) => {
  if (!body) {
    return { ok: false as const, error: 'Solicitud inválida: falta el cuerpo.' };
  }

  try {
    return { ok: true as const, value: JSON.parse(body) as T };
  } catch {
    return { ok: false as const, error: 'Solicitud inválida: el cuerpo no es JSON válido.' };
  }
};
