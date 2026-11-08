// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createExalabProxyHandler } from '../../../netlify/functions/exalab-proxy';

const originalEnv = { ...process.env };
const fetchMock = vi.fn();
const authorize = vi.fn();
const getServer = vi.fn();
const handler = createExalabProxyHandler({
  getFirebaseServer: getServer,
  authorizeRoleRequest: authorize,
});
let requestNumber = 0;
const request = (action: string, method = 'GET', body?: unknown, extraHeaders = {}) =>
  handler({
    rawQuery: `action=${action}`,
    httpMethod: method,
    headers: {
      origin: 'https://hhr.test',
      authorization: 'Bearer synthetic-firebase',
      'content-type': 'application/json',
      'x-nf-client-connection-ip': String(++requestNumber),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
beforeEach(() => {
  process.env = {
    ...originalEnv,
    URL: 'https://hhr.test',
    SYSLAB_PROXY_URL: 'https://bridge.test',
    SYSLAB_API_TOKEN: 'synthetic-private-gateway',
  };
  vi.stubGlobal('fetch', fetchMock);
  vi.clearAllMocks();
  authorize.mockResolvedValue({
    role: 'admin',
    token: { sub: 'operator-a', aud: 'synthetic-project' },
  });
  getServer.mockReturnValue({ db: {} });
});
afterEach(() => {
  process.env = originalEnv;
  vi.unstubAllGlobals();
});

describe('Exalab gateway', () => {
  it('derives ownership from verified Firebase claims and keeps the private bridge token server-side', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, data: [] })));
    const result = await handler({
      rawQuery: 'action=search',
      httpMethod: 'POST',
      headers: {
        origin: 'https://hhr.test',
        authorization: 'Bearer synthetic-firebase',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        rut: '12345678-5',
        from: '2026-11-01',
        to: '2026-11-08',
        owner: 'attacker',
      }),
    });
    expect(result.statusCode).toBe(200);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers['X-HHR-Lab-Owner']).toBe(
      createHash('sha256')
        .update(
          JSON.stringify([
            'synthetic-project',
            'operator-a',
            process.env.ACTIVE_HOSPITAL_ID || 'hanga_roa',
          ])
        )
        .digest('hex')
    );
    expect(options.headers.Authorization).toBe('Bearer synthetic-private-gateway');
    expect(options.body).not.toContain('attacker');
    expect(result.headers['Cache-Control']).toBe('no-store');
  });
  it('accepts a single-use connection capability without allowing its caller to select an operator', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true, connected: true })));
    const result = await request(
      'connect',
      'POST',
      { pair: 'a'.repeat(43), session: { cookies: [] }, owner: 'attacker' },
      { origin: `chrome-extension://${'a'.repeat(32)}` }
    );
    expect(result.statusCode).toBe(200);
    expect(authorize).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-HHR-Lab-Owner');
    expect(fetchMock.mock.calls[0][1].body).not.toContain('attacker');
  });
  it('rejects unauthorized roles, arbitrary origins and invalid methods before reaching the bridge', async () => {
    authorize.mockRejectedValue(new Error('secret-auth-error'));
    expect((await request('search', 'POST', {})).statusCode).toBe(403);
    expect(
      (await request('connect', 'POST', {}, { origin: 'https://attacker.test' })).statusCode
    ).toBe(403);
    expect((await request('pdf', 'POST')).statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('returns verified PDF bytes and rejects HTML or incomplete PDFs', async () => {
    const event = {
      rawQuery: 'action=pdf&link=hhr-exalab%3A%2F%2Freport%2Fsynthetic',
      httpMethod: 'GET',
      headers: { origin: 'https://hhr.test' },
    };
    fetchMock.mockResolvedValueOnce(new Response('%PDF-1.4\nsynthetic\n%%EOF'));
    const result = await handler(event);
    expect(result.statusCode).toBe(200);
    expect(result).toHaveProperty('isBase64Encoded', true);
    fetchMock.mockResolvedValueOnce(new Response('<html>secret-upstream</html>'));
    const failed = await handler(event);
    expect(failed.statusCode).toBe(502);
    expect(failed.body).not.toContain('secret-upstream');
  });
});
