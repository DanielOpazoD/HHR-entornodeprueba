/** Reads only the Exalab session cookies and hands them to HHR's gateway; values never reach a page. */
(function (root) {
  'use strict';
  const EXALAB_URL = 'https://exalab.saludoriente.cl/web_ssmo/index.php';
  const GRANT = Object.freeze({ permissions: ['cookies'], origins: ['https://exalab.saludoriente.cl/*'] });
  // Chrome's getAll({ url }) omits the signed-in session that get() finds, so read each cookie by name.
  const readCookies = async () =>
    (await Promise.all(['PHPSESSID', 'cf_clearance'].map(name => chrome.cookies.get({ url: EXALAB_URL, name }))))
      .filter(Boolean).map(({ name, value, domain }) => ({ name, value, domain }));
  const hasSession = cookies => cookies.some(cookie => cookie.name === 'PHPSESSID');
  const OWNER = /^[a-f0-9]{16}$/;
  // Resolves { connected, owner }: owner is the bridge's short fingerprint of the HHR account, when given.
  const connect = async (origin, pair, cookies, userAgent, expectedOwner) => {
    const response = await fetch(`${origin}/.netlify/functions/exalab-proxy?action=connect`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit',
      body: JSON.stringify({ pair, session: { cookies, userAgent }, ...(expectedOwner ? { expectedOwner } : {}) }),
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(50_000),
    });
    const result = await response.json().catch(() => null);
    const connected = response.ok && result?.success === true && result.connected === true;
    return { connected, owner: connected && OWNER.test(result.owner || '') ? result.owner : null };
  };
  // Silent reconnection is bound to the exact published HHR site that consented, never a local or preview host.
  const autoOrigin = origin => /^https:\/\/[^/]+$/.test(origin || '') && globalThis.HhrAppOrigins?.has(origin) &&
    !/^https:\/\/(?:localhost|127\.0\.0\.1)(?::|$)|--|deploy-preview-/.test(origin);
  root.HhrExalabSession = Object.freeze({ EXALAB_URL, GRANT, OWNER, readCookies, hasSession, connect, autoOrigin });
})(typeof self !== 'undefined' ? self : globalThis);
