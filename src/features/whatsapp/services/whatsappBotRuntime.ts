import { resolveCurrentUserAuthHeaders } from '@/services/auth/authRequestHeaders';

const BOT_SERVER_URL = (() => {
  const envUrl = import.meta.env.VITE_WHATSAPP_BOT_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/$/, '');
  }

  if (!import.meta.env.DEV) {
    return '/.netlify/functions/whatsapp-proxy';
  }

  return 'http://localhost:3001';
})();

export const buildBotUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${BOT_SERVER_URL}${normalizedPath}`;
};

const mergeRequestHeaders = (
  headers: RequestInit['headers'],
  authHeaders: Record<string, string>
): Headers => {
  const merged = new Headers(headers);
  Object.entries(authHeaders).forEach(([key, value]) => {
    if (!merged.has(key)) {
      merged.set(key, value);
    }
  });
  return merged;
};

export async function fetchBotJson(path: string, init?: RequestInit): Promise<Response> {
  const authHeaders = await resolveCurrentUserAuthHeaders();
  return fetch(buildBotUrl(path), {
    ...init,
    headers: mergeRequestHeaders(init?.headers, authHeaders),
  });
}
