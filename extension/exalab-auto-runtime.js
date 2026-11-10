/** Silent Exalab reconnection after a one-time consent; only booleans reach HHR pages. */
(() => {
  'use strict';
  const session = self.HhrExalabSession;
  const PAIR = /^[A-Za-z0-9_-]{43}$/;
  const trusted = sender => self.HhrAppOrigins.matchesUrl(sender?.tab?.url) && sender.frameId === 0;
  const granted = () => chrome.permissions.contains(session.GRANT);
  const KEYS = ['exalabAutoConnect', 'exalabAutoConnectOrigin', 'exalabAutoConnectOwner', 'exalabAutoConnectUser'];
  // Consent covers one published HHR site, one HHR account and one Exalab user (bridge fingerprints).
  const consent = async origin => {
    const stored = await chrome.storage.local.get(KEYS);
    return stored.exalabAutoConnect === true && stored.exalabAutoConnectOrigin === origin && session.autoOrigin(origin) &&
      session.OWNER.test(stored.exalabAutoConnectOwner || '') && session.OWNER.test(stored.exalabAutoConnectUser || '')
      ? { expectedOwner: stored.exalabAutoConnectOwner, expectedExalabUser: stored.exalabAutoConnectUser } : null;
  };
  const status = async origin => {
    const permission = await granted();
    return { permission, autoConnect: Boolean(await consent(origin)), session: permission && session.hasSession(await session.readCookies()) };
  };
  const autoConnect = async (origin, pair) => {
    const expected = PAIR.test(pair || '') && await granted() ? await consent(origin) : null;
    if (!expected) return { connected: false, reason: 'needs_consent' };
    const cookies = await session.readCookies();
    if (!session.hasSession(cookies)) return { connected: false, reason: 'no_session' };
    try {
      // The bridge refuses a pair of another HHR account or another person's Exalab session.
      const linked = await session.connect(origin, pair, cookies, navigator.userAgent, expected);
      if (linked.connected) return { connected: true, reason: 'connected' };
      // Another Exalab user here keeps this PC's consent but needs that person's own manual connection.
      return { connected: false, reason: linked.code === 'EXALAB_USER_MISMATCH' ? 'needs_consent' : 'rejected' };
    } catch { return { connected: false, reason: 'network' }; }
  };
  const handlers = {
    HHR_EXALAB_SESSION_STATUS: (_message, origin) => status(origin),
    HHR_EXALAB_AUTO_CONNECT: (message, origin) => autoConnect(origin, message.pair),
    HHR_EXALAB_FORGET: async () => { await chrome.storage.local.remove(KEYS); return { forgotten: true }; },
  };
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const handler = handlers[message?.type];
    if (!handler) return undefined;
    if (!trusted(sender)) { sendResponse(null); return undefined; }
    const origin = new URL(sender.tab.url).origin;
    Promise.resolve().then(() => handler(message, origin)).then(sendResponse, () => sendResponse(null));
    return true;
  });

  // A ClaveÚnica login rotates PHPSESSID: open HHR tabs hear about it (no values) and reconnect silently.
  let timer = null;
  const announce = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      for (const tab of await chrome.tabs.query({})) {
        if (tab.id != null && self.HhrAppOrigins.matchesUrl(tab.url)) {
          chrome.tabs.sendMessage(tab.id, { type: 'HHR_EXALAB_SESSION_AVAILABLE' }).catch(() => {});
        }
      }
    }, 2000);
  };
  const onCookie = ({ removed, cookie }) => {
    if (!removed && cookie?.name === 'PHPSESSID' && cookie.domain?.replace(/^\./, '') === 'exalab.saludoriente.cl') announce();
  };
  let listening = false;
  // Optional permission: chrome.cookies exists only once granted, so listen now or as soon as it is.
  const listen = () => {
    if (listening || !chrome.cookies?.onChanged) return;
    listening = true;
    chrome.cookies.onChanged.addListener(onCookie);
  };
  listen();
  chrome.permissions.onAdded?.addListener(listen);
})();
