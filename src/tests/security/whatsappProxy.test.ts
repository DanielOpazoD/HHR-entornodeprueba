import { createProviderError, credentialMarkers } from '../netlify/providerErrorFixture';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWhatsAppProxyHandler, handler } from '../../../netlify/functions/whatsapp-proxy';

describe('whatsapp-proxy', () => {
  it('redacts provider failures in details and logs', async () => {
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(createProviderError());
    const securedHandler = createWhatsAppProxyHandler({
      getFirebaseServer: getFirebaseServerMock as never,
      authorizeRoleRequest: authorizeRoleRequestMock as never,
      extractBearerToken: extractBearerTokenMock,
      fetch: fetchMock,
    });
    const result = await securedHandler({ httpMethod: 'GET', headers: {}, body: null });
    expect(result.statusCode).toBe(502);
    expect(JSON.parse(result.body).details).toContain('HTTP 503');
    const outputs =
      result.body +
      logs.mock.calls.map(call => call.map(String).join(' ')).join(' ') +
      JSON.stringify(logs.mock.calls);
    for (const marker of credentialMarkers) expect(outputs).not.toContain(marker);
  });
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();
  const getFirebaseServerMock = vi.fn(() => ({ db: {} }));
  const authorizeRoleRequestMock = vi.fn().mockResolvedValue({
    uid: 'u1',
    email: 'nurse@hospital.test',
    role: 'nurse_hospital',
  });
  const extractBearerTokenMock = vi.fn().mockReturnValue('token');

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      WHATSAPP_BOT_URL: 'https://bot.example.com',
      URL: 'https://app.example.com',
      DEPLOY_PRIME_URL: '',
      DEPLOY_URL: '',
      SITE_URL: '',
      APP_URL: '',
    };
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('allows configured origins on preflight requests', async () => {
    const response = await handler({
      httpMethod: 'OPTIONS',
      headers: { origin: 'https://app.example.com' },
      body: null,
      path: '/.netlify/functions/whatsapp-proxy/messages',
    });
    const headers = response.headers as Record<string, string>;

    expect(response.statusCode).toBe(200);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    expect(headers.Vary).toBe('Origin');
  });

  it('rejects requests from untrusted origins', async () => {
    const response = await handler({
      httpMethod: 'POST',
      headers: { origin: 'https://evil.example.com' },
      body: '{"ok":true}',
      path: '/.netlify/functions/whatsapp-proxy/messages',
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toContain('Origin not allowed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a bearer token before forwarding requests', async () => {
    const securedHandler = createWhatsAppProxyHandler({
      getFirebaseServer: getFirebaseServerMock as never,
      authorizeRoleRequest: authorizeRoleRequestMock as never,
      extractBearerToken: vi.fn(() => {
        throw new Error('Missing Authorization bearer token.');
      }) as never,
      fetch: fetchMock,
    });

    const response = await securedHandler({
      httpMethod: 'POST',
      headers: {
        origin: 'https://app.example.com',
        'content-type': 'application/json',
      },
      body: '{"message":"hola"}',
      path: '/.netlify/functions/whatsapp-proxy/messages',
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).toContain('Missing Authorization bearer token.');
    expect(authorizeRoleRequestMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects callers without an allowed role', async () => {
    const securedHandler = createWhatsAppProxyHandler({
      getFirebaseServer: getFirebaseServerMock as never,
      authorizeRoleRequest: vi
        .fn()
        .mockRejectedValue(new Error('Access denied for role viewer.')) as never,
      extractBearerToken: extractBearerTokenMock as never,
      fetch: fetchMock,
    });

    const response = await securedHandler({
      httpMethod: 'POST',
      headers: {
        origin: 'https://app.example.com',
        'content-type': 'application/json',
        authorization: 'Bearer token',
      },
      body: '{"message":"hola"}',
      path: '/.netlify/functions/whatsapp-proxy/messages',
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toContain('Access denied for role viewer.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards requests to the bot and reflects the trusted origin', async () => {
    fetchMock.mockResolvedValue({
      status: 202,
      text: vi.fn().mockResolvedValue('{"sent":true}'),
      headers: new Headers({ 'content-type': 'application/json' }),
    });
    const securedHandler = createWhatsAppProxyHandler({
      getFirebaseServer: getFirebaseServerMock as never,
      authorizeRoleRequest: authorizeRoleRequestMock as never,
      extractBearerToken: extractBearerTokenMock as never,
      fetch: fetchMock,
    });

    const response = await securedHandler({
      httpMethod: 'POST',
      headers: {
        origin: 'https://app.example.com',
        'content-type': 'application/json',
        authorization: 'Bearer token',
      },
      body: '{"message":"hola"}',
      path: '/.netlify/functions/whatsapp-proxy/messages',
      rawQuery: 'channel=handoff',
    });
    const headers = response.headers as Record<string, string>;

    expect(fetchMock).toHaveBeenCalledWith('https://bot.example.com/messages?channel=handoff', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer token',
      },
      body: '{"message":"hola"}',
      signal: expect.any(AbortSignal),
    });
    expect(extractBearerTokenMock).toHaveBeenCalledWith('Bearer token');
    expect(authorizeRoleRequestMock).toHaveBeenCalledTimes(1);
    expect(response.statusCode).toBe(202);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    expect(headers['Content-Type']).toBe('application/json');
  });

  describe('upstream response deadline', () => {
    const event = {
      httpMethod: 'POST',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer token',
        'x-forwarded-for': '192.0.2.29',
      },
      body: '{"message":"synthetic"}',
      path: '/.netlify/functions/whatsapp-proxy/messages',
    };
    const securedHandler = () =>
      createWhatsAppProxyHandler({
        getFirebaseServer: getFirebaseServerMock as never,
        authorizeRoleRequest: authorizeRoleRequestMock as never,
        extractBearerToken: extractBearerTokenMock,
        fetch: fetchMock,
      });

    it.each([202, 503])('preserves the upstream status %s, body and content type', async status => {
      fetchMock.mockResolvedValue(
        new Response('synthetic response', { status, headers: { 'content-type': 'text/plain' } })
      );
      const response = await securedHandler()(event);
      expect(response).toMatchObject({
        statusCode: status,
        body: 'synthetic response',
        headers: { 'Content-Type': 'text/plain' },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(['headers', 'body'])('returns the existing timeout when %s stall', async phase => {
      vi.useFakeTimers();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      let upstreamSignal: AbortSignal | null | undefined;
      let bodyStarted = false;
      fetchMock.mockImplementation((_url: string, init: RequestInit) => {
        upstreamSignal = init.signal;
        if (phase === 'headers') {
          return new Promise<Response>((_resolve, reject) => {
            upstreamSignal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          });
        }
        const stream = new ReadableStream({
          start(controller) {
            upstreamSignal?.addEventListener('abort', () => {
              controller.error(new DOMException('Aborted', 'AbortError'));
            });
          },
        });
        const response = new Response(stream);
        const readText = response.text.bind(response);
        vi.spyOn(response, 'text').mockImplementation(() => {
          bodyStarted = true;
          return readText();
        });
        return Promise.resolve(response);
      });
      let result: Awaited<ReturnType<ReturnType<typeof createWhatsAppProxyHandler>>> | undefined;
      const pending = securedHandler()(event).then(response => {
        result = response;
      });
      await vi.advanceTimersByTimeAsync(7_999);
      expect(result).toBeUndefined();
      expect(bodyStarted).toBe(phase === 'body');
      await vi.advanceTimersByTimeAsync(1);
      expect(result).toMatchObject({
        statusCode: 502,
        body: JSON.stringify({
          error: 'Failed to reach WhatsApp bot server',
          details: 'Operation timed out after 8000ms',
        }),
      });
      expect(output).not.toHaveBeenCalled();
      await pending;
      expect(upstreamSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(errors).toHaveBeenCalledWith(expect.stringContaining('"status":"timeout"'));
    });
  });
});
