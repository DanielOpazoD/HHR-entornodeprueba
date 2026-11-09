// @vitest-environment node
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
const source = (name: string) =>
  readFileSync(new URL(`../../../extension/${name}`, import.meta.url), 'utf8');
const pair = 'a'.repeat(43);
const page = (origin = 'https://hhr-hospitalizados.app', granted = true, remember = true) => {
  const clickHandlers: Record<string, () => Promise<void>> = {};
  const elements = Object.fromEntries(
    ['connect', 'status', 'back', 'auto'].map(id => [
      id,
      {
        checked: id === 'auto' && remember,
        disabled: false,
        hidden: false,
        textContent: '',
        addEventListener: (_type: string, handler: () => Promise<void>) => {
          clickHandlers[id] = handler;
        },
      },
    ])
  );
  const jar: Record<string, { name: string; value: string; domain: string }> = {
    PHPSESSID: { name: 'PHPSESSID', value: 'synthetic-only', domain: 'exalab.saludoriente.cl' },
    unrelated_cookie: {
      name: 'unrelated_cookie',
      value: 'must-not-leave-browser',
      domain: 'exalab.saludoriente.cl',
    },
  };
  const cookies = vi.fn(async ({ name }: { url: string; name: string }) => jar[name] ?? null);
  const permission = vi.fn(async () => granted);
  const store = vi.fn(async (_value: unknown) => undefined);
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ success: true, connected: true, owner: '0123456789abcdef' }))
  );
  const context = vm.createContext({
    URLSearchParams,
    AbortSignal,
    history: { replaceState: vi.fn() },
    location: {
      hash: '#' + new URLSearchParams({ origin, pair }),
      pathname: '/exalab-connect.html',
    },
    document: { getElementById: (id: string) => elements[id] },
    navigator: { userAgent: 'synthetic-UA' },
    window: { close: vi.fn() },
    chrome: {
      permissions: { request: permission },
      cookies: { get: cookies },
      storage: { local: { set: store } },
    },
    fetch: fetchMock,
  });
  vm.runInContext(source('hhr-origin-policy.js'), context);
  vm.runInContext(source('exalab-session-transport.js'), context);
  vm.runInContext(source('exalab-connect.js'), context);
  return { clickHandlers, elements, cookies, permission, fetchMock, store };
};
describe('Exalab personal-session consent', () => {
  it('reads only applicable session cookies after the user gesture and sends them directly to the trusted gateway', async () => {
    const harness = page();
    expect(harness.cookies).not.toHaveBeenCalled();
    expect(harness.fetchMock).not.toHaveBeenCalled();
    await harness.clickHandlers.connect();
    expect(harness.permission).toHaveBeenCalledWith({
      permissions: ['cookies'],
      origins: ['https://exalab.saludoriente.cl/*'],
    });
    expect(harness.cookies.mock.calls.map(([query]) => query)).toEqual([
      { url: 'https://exalab.saludoriente.cl/web_ssmo/index.php', name: 'PHPSESSID' },
      { url: 'https://exalab.saludoriente.cl/web_ssmo/index.php', name: 'cf_clearance' },
    ]);
    const [url, options] = harness.fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://hhr-hospitalizados.app/.netlify/functions/exalab-proxy?action=connect'
    );
    expect(options.body).toContain('synthetic-only');
    expect(JSON.parse(String(options.body)).session.userAgent).toBe('synthetic-UA');
    expect(options.body).not.toContain('must-not-leave-browser');
    expect(harness.elements.status.textContent).toBe(
      'Sesión conectada. Puedes cerrar esta pestaña.'
    );
    expect(harness.store).toHaveBeenCalledWith({
      exalabAutoConnect: true,
      exalabAutoConnectOrigin: 'https://hhr-hospitalizados.app',
      exalabAutoConnectOwner: '0123456789abcdef',
    });
    expect(JSON.parse(String(options.body))).not.toHaveProperty('expectedOwner');
  });
  it.each([
    ['declined by the user', 'https://hhr-hospitalizados.app', false],
    ['a local HHR', 'http://localhost:3001', true],
    ['a deploy preview', 'https://deploy-preview-12--testinghhr.netlify.app', true],
  ])(
    'connects but does not remember automatic reconnection when %s',
    async (_case, origin, remember) => {
      const harness = page(origin, true, remember);
      await harness.clickHandlers.connect();
      expect(harness.fetchMock).toHaveBeenCalledTimes(1);
      expect(harness.store).toHaveBeenCalledWith({
        exalabAutoConnect: false,
        exalabAutoConnectOrigin: null,
        exalabAutoConnectOwner: null,
      });
    }
  );
  it('does not read cookies when permission is denied or the pairing origin is untrusted', async () => {
    const denied = page(undefined, false);
    await denied.clickHandlers.connect();
    expect(denied.cookies).not.toHaveBeenCalled();
    expect(denied.fetchMock).not.toHaveBeenCalled();
    expect(denied.store).not.toHaveBeenCalled();
    const attacker = page('https://attacker.test');
    expect(attacker.elements.connect.disabled).toBe(true);
    expect(attacker.clickHandlers.connect).toBeUndefined();
  });
  it('opens the connection page only for a top-level trusted HHR sender', async () => {
    let listener: (
      message: unknown,
      sender: unknown,
      respond: (value: unknown) => void
    ) => unknown = () => undefined;
    const create = vi.fn(async (_options: unknown) => ({}));
    const response = vi.fn();
    const context = vm.createContext({
      URL,
      URLSearchParams,
      chrome: {
        runtime: {
          getURL: (path: string) => `chrome-extension://synthetic/${path}`,
          onMessage: {
            addListener: (value: typeof listener) => {
              listener = value;
            },
          },
        },
        tabs: { create },
      },
    });
    vm.runInContext(source('hhr-origin-policy.js'), context);
    context.self = context;
    vm.runInContext(source('exalab-background.js'), context);
    listener(
      { type: 'HHR_EXALAB_OPEN_CONNECT', pair },
      { frameId: 1, tab: { url: 'https://hhr-hospitalizados.app/', id: 1 } },
      response
    );
    listener(
      { type: 'HHR_EXALAB_OPEN_CONNECT', pair },
      { frameId: 0, tab: { url: 'https://attacker.test/', id: 1 } },
      response
    );
    expect(create).not.toHaveBeenCalled();
    listener(
      { type: 'HHR_EXALAB_OPEN_CONNECT', pair },
      { frameId: 0, tab: { url: 'https://hhr-hospitalizados.app/', id: 1 } },
      response
    );
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0]).toMatchObject({ openerTabId: 1 });
  });
});
