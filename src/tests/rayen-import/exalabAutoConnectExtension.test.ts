// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
const source = (name: string) =>
  readFileSync(new URL(`../../../extension/${name}`, import.meta.url), 'utf8');
const pair = 'a'.repeat(43);
const hhr = { frameId: 0, tab: { url: 'https://hhr-hospitalizados.app/censo', id: 7 } };
type Listener = (message: unknown, sender: unknown, respond: (value: unknown) => void) => unknown;
type CookieListener = (change: {
  removed: boolean;
  cookie: { name: string; domain: string };
}) => void;
const OWNER = '0123456789abcdef';
const USER = 'fedcba9876543210';
const worker = ({
  granted = true,
  remember = true,
  signedIn = true,
  connected = true,
  origin = 'https://hhr-hospitalizados.app',
  owner = OWNER as string | null,
  user = USER as string | null,
  code = null as string | null,
} = {}) => {
  let listener: Listener = () => undefined;
  let cookieListener: CookieListener = () => undefined;
  const jar: Record<string, { name: string; value: string; domain: string }> = signedIn
    ? {
        PHPSESSID: { name: 'PHPSESSID', value: 'synthetic-only', domain: 'exalab.saludoriente.cl' },
      }
    : {};
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ success: connected, connected, ...(code ? { code } : {}) }), {
        status: connected ? 200 : 403,
      })
  );
  const sendMessage = vi.fn(async () => undefined);
  const remove = vi.fn(async () => undefined);
  const context = vm.createContext({
    URL,
    AbortSignal,
    setTimeout,
    clearTimeout,
    navigator: { userAgent: 'synthetic-UA' },
    fetch: fetchMock,
    chrome: {
      runtime: { onMessage: { addListener: (value: Listener) => (listener = value) } },
      permissions: { contains: vi.fn(async () => granted), onAdded: { addListener: vi.fn() } },
      storage: {
        local: {
          get: vi.fn(async () => ({
            exalabAutoConnect: remember,
            exalabAutoConnectOrigin: origin,
            exalabAutoConnectOwner: owner,
            exalabAutoConnectUser: user,
          })),
          remove,
        },
      },
      cookies: {
        get: vi.fn(async ({ name }: { name: string }) => jar[name] ?? null),
        onChanged: { addListener: (value: CookieListener) => (cookieListener = value) },
      },
      tabs: {
        query: vi.fn(async () => [
          { id: 7, url: 'https://hhr-hospitalizados.app/censo' },
          { id: 8, url: 'https://attacker.test/' },
        ]),
        sendMessage,
      },
    },
  });
  context.self = context;
  for (const file of [
    'hhr-origin-policy.js',
    'exalab-session-transport.js',
    'exalab-auto-runtime.js',
  ])
    vm.runInContext(source(file), context);
  const ask = (message: unknown, sender: unknown = hhr) =>
    new Promise(resolve => {
      if (listener(message, sender, resolve) !== true) resolve('sync');
    });
  return {
    ask,
    fetchMock,
    sendMessage,
    remove,
    cookieChanged: (change: Parameters<CookieListener>[0]) => cookieListener(change),
  };
};
afterEach(() => vi.useRealTimers());
describe('Exalab silent reconnection', () => {
  it('reports only booleans to HHR, never cookie values', async () => {
    const status = await worker().ask({ type: 'HHR_EXALAB_SESSION_STATUS' });
    expect(status).toEqual({ permission: true, autoConnect: true, session: true });
    expect(JSON.stringify(status)).not.toContain('synthetic-only');
    expect(JSON.stringify(status)).not.toContain(OWNER);
    const elsewhere = await worker({ origin: 'https://testinghhr.netlify.app' }).ask({
      type: 'HHR_EXALAB_SESSION_STATUS',
    });
    expect(elsewhere).toMatchObject({ autoConnect: false });
  });
  it('connects through the same gateway as the consent page once consent is remembered', async () => {
    const harness = worker();
    await expect(harness.ask({ type: 'HHR_EXALAB_AUTO_CONNECT', pair })).resolves.toEqual({
      connected: true,
      reason: 'connected',
    });
    const [url, options] = harness.fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://hhr-hospitalizados.app/.netlify/functions/exalab-proxy?action=connect'
    );
    expect(options).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error' });
    expect(JSON.parse(String(options.body))).toEqual({
      pair,
      session: {
        cookies: [{ name: 'PHPSESSID', value: 'synthetic-only', domain: 'exalab.saludoriente.cl' }],
        userAgent: 'synthetic-UA',
      },
      expectedOwner: OWNER,
      expectedExalabUser: USER,
    });
  });
  it.each([
    [{ granted: false }, 'needs_consent'],
    [{ remember: false }, 'needs_consent'],
    [{ signedIn: false }, 'no_session'],
    [{ connected: false }, 'rejected'],
    [{ owner: null }, 'needs_consent'],
    [{ owner: 'not-a-fingerprint' }, 'needs_consent'],
    [{ user: null }, 'needs_consent'],
    [{ connected: false, code: 'EXALAB_USER_MISMATCH' }, 'needs_consent'],
    [{ connected: false, code: 'OWNER_MISMATCH' }, 'rejected'],
    [{ origin: 'https://testinghhr.netlify.app' }, 'needs_consent'],
  ])('does not pretend to connect (%o → %s)', async (options, reason) => {
    const harness = worker(options);
    await expect(harness.ask({ type: 'HHR_EXALAB_AUTO_CONNECT', pair })).resolves.toEqual({
      connected: false,
      reason,
    });
    if (!('connected' in options)) expect(harness.fetchMock).not.toHaveBeenCalled();
    // Another person's Exalab session never erases this PC's consent.
    expect(harness.remove).not.toHaveBeenCalled();
  });
  it('answers nothing to untrusted senders or subframes and forgets consent on request', async () => {
    const harness = worker();
    await expect(
      harness.ask(
        { type: 'HHR_EXALAB_AUTO_CONNECT', pair },
        { frameId: 0, tab: { url: 'https://attacker.test/' } }
      )
    ).resolves.toBeNull();
    await expect(
      harness.ask({ type: 'HHR_EXALAB_SESSION_STATUS' }, { ...hhr, frameId: 2 })
    ).resolves.toBeNull();
    expect(harness.fetchMock).not.toHaveBeenCalled();
    await expect(harness.ask({ type: 'HHR_EXALAB_FORGET' })).resolves.toEqual({ forgotten: true });
    expect(harness.remove).toHaveBeenCalledWith([
      'exalabAutoConnect',
      'exalabAutoConnectOrigin',
      'exalabAutoConnectOwner',
      'exalabAutoConnectUser',
    ]);
  });
  it('tells open HHR tabs, once and without values, when Exalab gets a new session', async () => {
    vi.useFakeTimers();
    const harness = worker();
    const change = {
      removed: false,
      cookie: { name: 'PHPSESSID', domain: 'exalab.saludoriente.cl' },
    };
    harness.cookieChanged(change);
    harness.cookieChanged(change);
    harness.cookieChanged({ ...change, removed: true });
    harness.cookieChanged({
      removed: false,
      cookie: { name: 'other', domain: 'exalab.saludoriente.cl' },
    });
    await vi.advanceTimersByTimeAsync(2100);
    expect(harness.sendMessage).toHaveBeenCalledTimes(1);
    expect(harness.sendMessage).toHaveBeenCalledWith(7, { type: 'HHR_EXALAB_SESSION_AVAILABLE' });
  });
});
describe('HHR page relay for Exalab reconnection', () => {
  const relay = (origin: string) => {
    const pageListeners: ((event: unknown) => unknown)[] = [];
    let runtimeListener: (message: unknown) => void = () => undefined;
    const posted: unknown[] = [];
    const sendMessage = vi.fn(async (message: { type: string }) =>
      message.type === 'HHR_EXALAB_SESSION_STATUS'
        ? { permission: true, autoConnect: true, session: true }
        : null
    );
    const window = {
      location: { origin },
      addEventListener: (_type: string, handler: (event: unknown) => unknown) =>
        pageListeners.push(handler),
      removeEventListener: vi.fn(),
      postMessage: (data: unknown) => posted.push(data),
    };
    const context = vm.createContext({
      window,
      chrome: {
        runtime: {
          id: 'synthetic',
          sendMessage,
          onMessage: {
            addListener: (value: typeof runtimeListener) => (runtimeListener = value),
            removeListener: vi.fn(),
          },
        },
      },
    });
    context.globalThis = context;
    vm.runInContext(source('hhr-origin-policy.js'), context);
    vm.runInContext(source('content-hhr-exalab-auto.js'), context);
    const send = (data: unknown, from = window) =>
      Promise.all(pageListeners.map(handler => handler({ source: from, origin, data })));
    return { send, posted, sendMessage, notify: (message: unknown) => runtimeListener(message) };
  };
  it('relays known requests with their reply and forwards session announcements', async () => {
    const harness = relay('https://hhr-hospitalizados.app');
    await harness.send({ type: 'HHR_EXALAB_SESSION_STATUS', reqId: 'r1' });
    await harness.send({ type: 'HHR_EXALAB_UNKNOWN', reqId: 'r2' });
    expect(harness.sendMessage).toHaveBeenCalledTimes(1);
    expect(harness.posted).toEqual([
      {
        type: 'HHR_EXALAB_SESSION_STATUS_RESULT',
        reqId: 'r1',
        result: { permission: true, autoConnect: true, session: true },
      },
    ]);
    harness.notify({ type: 'HHR_EXALAB_SESSION_AVAILABLE' });
    expect(harness.posted.at(-1)).toEqual({ type: 'HHR_EXALAB_SESSION_AVAILABLE' });
  });
  it('stays inert outside HHR', async () => {
    const harness = relay('https://attacker.test');
    await harness.send({ type: 'HHR_EXALAB_SESSION_STATUS', reqId: 'r1' });
    expect(harness.sendMessage).not.toHaveBeenCalled();
  });
});
