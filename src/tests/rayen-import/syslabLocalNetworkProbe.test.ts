// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { TextDecoder, TextEncoder } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

const source =
  readFileSync('extension/syslab-network-probe.js', 'utf8') +
  '\n' +
  readFileSync('extension/syslab-bridge.js', 'utf8');
const searchUrl = 'http://10.4.69.90/syslab/parbusqueRut.php';

const probe = (fetchMock: ReturnType<typeof vi.fn>) => {
  let listener!: (message: unknown, sender: unknown, reply: (value: unknown) => void) => void;
  const context: Record<string, unknown> = {
    document,
    DOMParser,
    TextDecoder,
    Uint8Array,
    AbortController,
    URL,
    setTimeout,
    clearTimeout,
    location: { href: 'http://10.4.69.90/syslab/aplicacion.php' },
    addEventListener: vi.fn(),
    fetch: fetchMock,
    chrome: {
      runtime: {
        getURL: () => 'chrome-extension://test/',
        onMessage: {
          addListener: (callback: typeof listener) => {
            listener = callback;
          },
        },
      },
    },
  };
  context.window = context;
  context.self = context;
  context.parent = context;
  vm.runInNewContext(source, context);
  return new Promise<Record<string, unknown>>(resolve => {
    listener({ type: 'RAYEN_SYSLAB_STATUS', verifyNetwork: true }, {}, value =>
      resolve(value as Record<string, unknown>)
    );
  });
};

const response = (html: string, overrides = {}) => ({
  ok: true,
  url: searchUrl,
  headers: { get: () => null },
  arrayBuffer: async () => new TextEncoder().encode(html).buffer,
  ...overrides,
});

describe('Syslab patient-free local connection probe', () => {
  afterEach(() => vi.useRealTimers());

  it('checks the real form with cookies, no cache and no patient identifier', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response('<form><input name="rut"></form>'));
    await expect(probe(fetchMock)).resolves.toMatchObject({
      networkVerified: true,
      loginRequired: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      searchUrl,
      expect.objectContaining({
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('detects an expired session even if the existing tab still looks authenticated', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(response('<input type="password" name="password">'));
    await expect(probe(fetchMock)).resolves.toMatchObject({
      networkVerified: true,
      loginRequired: true,
    });
  });

  it.each([
    response('<p>Captive portal</p>'),
    response('<input name="rut">', { ok: false }),
    response('<input name="rut">', { url: 'https://other.example/syslab/' }),
    response('<input name="rut">', { url: 'http://10.4.69.90/other/' }),
  ])('rejects an unrecognized response, HTTP failure or foreign redirect', async value => {
    await expect(probe(vi.fn().mockResolvedValue(value))).resolves.toMatchObject({
      networkVerified: false,
    });
  });

  it('aborts a stalled local request after two seconds', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, { signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        })
    );
    const pending = probe(fetchMock);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toMatchObject({ networkVerified: false });
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
});
