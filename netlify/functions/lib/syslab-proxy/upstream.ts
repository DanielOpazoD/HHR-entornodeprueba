import { readResponseWithinLimit } from '../bounded-response';

const TIMEOUT_MS = 50_000; // Leave room for the gateway response within the platform budget.
const MAX_JSON_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_LAB_LINK_LENGTH = 8192;
const ALLOWED_LAB_LINK_PROTOCOLS = new Set(['https:', 'http:', 'hhr-syslab-remote:']);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export const MAX_REQUEST_BODY_BYTES = 65_536;
export const MAX_PDF_RESPONSE_BYTES = 4 * 1024 * 1024;
export const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export const getProxyUrl = (): string | null => {
  const raw =
    process.env.SYSLAB_PROXY_URL?.replace(/\/+$/, '') ||
    process.env.VITE_SYSLAB_API_URL?.replace(/\/+$/, '') ||
    null;
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) {
      return null;
    }
    if (parsed.protocol === 'https:') {
      return parsed.href.replace(/\/+$/, '');
    }
    if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) {
      return parsed.href.replace(/\/+$/, '');
    }
    return null;
  } catch {
    return null;
  }
};

export const isAllowedLabLink = (value: string): boolean => {
  if (!value || value.length > MAX_LAB_LINK_LENGTH) return false;
  try {
    const parsed = new URL(value);
    return ALLOWED_LAB_LINK_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
};

export const readBoundedJson = async (response: Response): Promise<unknown> => {
  if (response.body || typeof response.arrayBuffer === 'function') {
    const bytes = await readResponseWithinLimit(response, MAX_JSON_RESPONSE_BYTES);
    if (!bytes) {
      throw new Error('Upstream laboratory response exceeded size limit.');
    }
    return JSON.parse(bytes.toString('utf8')) as unknown;
  }
  return (await response.json()) as unknown;
};

export const isTimeoutError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return error.name === 'AbortError' || error.name === 'TimeoutError' || code === 'ETIMEDOUT';
};

export const proxyFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${process.env.SYSLAB_API_TOKEN || ''}`,
      'ngrok-skip-browser-warning': 'true',
      'User-Agent': 'HHR-Netlify-Function',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'error',
  });
};
