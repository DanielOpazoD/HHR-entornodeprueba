export const MMRAD_BASE_URL = 'https://ris.mmrad.cl';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
export const MMRAD_ALLOWED_ROLES = new Set([
  'admin',
  'nurse_hospital',
  'doctor_urgency',
  'doctor_specialist',
  'editor',
  'viewer',
]);

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

export const fetchWithHeaders = async (
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

export const decodeResponseHtml = async (
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

export const normalizeMmradUrl = (rawUrl: string | null | undefined): string | null => {
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

interface LoginResult {
  cookies: string;
  searchActionUrl: string | null;
}

export const loginToMMRAD = async (signal?: AbortSignal): Promise<LoginResult> => {
  const { username, password } = getCredentials();
  let cookies = '';

  // Step 1: GET home page → extract login form action + initial cookies
  const step1 = await fetchWithHeaders(`${MMRAD_BASE_URL}/web/guest/home`, {
    redirect: 'manual',
    signal,
  });
  cookies = mergeCookies(cookies, collectSetCookies(step1));
  const step1Html = await step1.text();
  const loginActionUrl = extractLoginActionUrl(step1Html);

  if (!loginActionUrl) {
    return { cookies, searchActionUrl: null };
  }

  // Step 2: POST login credentials
  const step2 = await fetchWithHeaders(loginActionUrl, {
    method: 'POST',
    signal,
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
      signal,
      headers: { Cookie: cookies },
    });
    cookies = mergeCookies(cookies, collectSetCookies(step3));
    const redirect2 = step3.headers.get('location') || '';

    // Step 4: Follow second redirect (typically /group/hhangaroa)
    if (redirect2) {
      const url4 = redirect2.startsWith('http') ? redirect2 : `${MMRAD_BASE_URL}${redirect2}`;
      const step4 = await fetchWithHeaders(url4, { signal, headers: { Cookie: cookies } });
      cookies = mergeCookies(cookies, collectSetCookies(step4));
      const dashboardHtml = await step4.text();
      const searchActionUrl = extractSearchActionUrl(dashboardHtml);
      return { cookies, searchActionUrl };
    }
  }

  return { cookies, searchActionUrl: null };
};
