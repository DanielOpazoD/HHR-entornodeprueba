import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  restoreConsole,
  type RestorableSpy,
  suppressConsole,
  suppressProcessStdout,
} from '@/tests/utils/consoleTestUtils';

describe('syslab-proxy', () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();
  const getFirebaseServerMock = vi.fn();
  const authorizeRoleRequestMock = vi.fn();
  const extractBearerTokenMock = vi.fn();
  let stdoutSpy: RestorableSpy;
  const loadHandler = async () => {
    const { createSyslabProxyHandler } = await import('../../../netlify/functions/syslab-proxy');
    return createSyslabProxyHandler({
      getFirebaseServer: getFirebaseServerMock as typeof getFirebaseServerMock,
      authorizeRoleRequest: authorizeRoleRequestMock as typeof authorizeRoleRequestMock,
      extractBearerToken: extractBearerTokenMock as typeof extractBearerTokenMock,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      SYSLAB_PROXY_URL: 'https://lab.example.com',
      URL: 'https://app.example.com',
      DEPLOY_PRIME_URL: '',
      DEPLOY_URL: '',
      SITE_URL: '',
      APP_URL: '',
    };
    vi.stubGlobal('fetch', fetchMock);
    getFirebaseServerMock.mockReturnValue({ db: { kind: 'firestore' } });
    authorizeRoleRequestMock.mockResolvedValue({
      email: 'doctor@hospital.cl',
      role: 'doctor_urgency',
    });
    extractBearerTokenMock.mockReturnValue('token-123');
    stdoutSpy = suppressProcessStdout();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('returns 200 with CORS headers on OPTIONS', async () => {
    const handler = await loadHandler();
    const response = await handler({
      httpMethod: 'OPTIONS',
      headers: { origin: 'https://app.example.com' },
      body: null,
      rawQuery: '',
    });
    const headers = response.headers as Record<string, string>;

    expect(response.statusCode).toBe(200);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    expect(headers.Vary).toBe('Origin');
  });

  it('returns 503 when SYSLAB_PROXY_URL is not configured', async () => {
    const handler = await loadHandler();
    delete process.env.SYSLAB_PROXY_URL;
    delete process.env.VITE_SYSLAB_API_URL;

    const response = await handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer token-123' },
      body: null,
      rawQuery: 'action=search&rut=12345678-9',
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('VITE_SYSLAB_API_URL');
  });

  it('uses VITE_SYSLAB_API_URL as fallback when SYSLAB_PROXY_URL is missing', async () => {
    const handler = await loadHandler();
    delete process.env.SYSLAB_PROXY_URL;
    process.env.VITE_SYSLAB_API_URL = 'http://localhost:3000';
    fetchMock.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ exams: [] }),
    });

    const response = await handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer token-123' },
      body: null,
      rawQuery: 'action=search&rut=12345678-9',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3000/api/exams?rut=12345678-9');
    expect(response.statusCode).toBe(200);
  });

  it('returns 400 for an invalid action', async () => {
    const handler = await loadHandler();
    const response = await handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer token-123' },
      body: null,
      rawQuery: 'action=unknown',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('no válida');
  });

  it('returns connected health when the upstream Syslab proxy responds', async () => {
    const handler = await loadHandler();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ status: 'ok' }),
    });

    const response = await handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer token-123' },
      body: null,
      rawQuery: 'action=health',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://lab.example.com/health',
      expect.objectContaining({ method: 'GET' })
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"connected":true');
  });

  it('returns disconnected health without throwing when upstream Syslab is unavailable', async () => {
    const handler = await loadHandler();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    const response = await handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer token-123' },
      body: null,
      rawQuery: 'action=health',
    });

    expect(response.statusCode).toBe(503);
    expect(response.body).toContain('"connected":false');
  });

  /* ── action=search ───────────────────────────────────────────────────── */

  describe('action=search', () => {
    it('returns 400 when rut param is missing', async () => {
      const handler = await loadHandler();
      const response = await handler({
        httpMethod: 'GET',
        headers: { authorization: 'Bearer token-123' },
        body: null,
        rawQuery: 'action=search',
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('RUT');
    });

    it('forwards search request to the proxy with correct URL', async () => {
      const handler = await loadHandler();
      fetchMock.mockResolvedValue({
        status: 200,
        json: vi.fn().mockResolvedValue({ exams: [] }),
      });

      const response = await handler({
        httpMethod: 'GET',
        headers: { authorization: 'Bearer token-123' },
        body: null,
        rawQuery: 'action=search&rut=12345678-9',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callUrl = fetchMock.mock.calls[0][0] as string;
      expect(callUrl).toBe('https://lab.example.com/api/exams?rut=12345678-9');
      expect(response.statusCode).toBe(200);
    });

    it('returns 502 on proxy error', async () => {
      const handler = await loadHandler();
      fetchMock.mockResolvedValue({
        status: 500,
        json: vi.fn().mockResolvedValue({ error: 'internal' }),
      });

      const response = await handler({
        httpMethod: 'GET',
        headers: { authorization: 'Bearer token-123' },
        body: null,
        rawQuery: 'action=search&rut=12345678-9',
      });

      expect(response.statusCode).toBe(502);
    });
  });

  /* ── action=details ──────────────────────────────────────────────────── */

  describe('action=details', () => {
    it('returns 400 when body is missing', async () => {
      const handler = await loadHandler();
      const response = await handler({
        httpMethod: 'POST',
        headers: { authorization: 'Bearer token-123' },
        body: null,
        rawQuery: 'action=details',
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('falta el cuerpo');
    });

    it('returns 400 when links array is empty', async () => {
      const handler = await loadHandler();
      const response = await handler({
        httpMethod: 'POST',
        headers: { authorization: 'Bearer token-123' },
        body: JSON.stringify({ links: [] }),
        rawQuery: 'action=details',
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('links');
    });

    it('forwards POST to the proxy with the links payload', async () => {
      const handler = await loadHandler();
      fetchMock.mockResolvedValue({
        status: 200,
        json: vi.fn().mockResolvedValue({ details: [{ name: 'Hemograma' }] }),
      });

      const links = ['https://lab.example.com/pdf/1', 'https://lab.example.com/pdf/2'];
      const response = await handler({
        httpMethod: 'POST',
        headers: { authorization: 'Bearer token-123' },
        body: JSON.stringify({ links }),
        rawQuery: 'action=details',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const callUrl = fetchMock.mock.calls[0][0] as string;
      expect(callUrl).toBe('https://lab.example.com/api/exams/details');
      const callOptions = fetchMock.mock.calls[0][1] as RequestInit;
      expect(callOptions.method).toBe('POST');
      expect(response.statusCode).toBe(200);
    });
  });

  /* ── action=pdf ──────────────────────────────────────────────────────── */

  describe('action=pdf', () => {
    it('returns 400 when link param is missing', async () => {
      const handler = await loadHandler();
      const response = await handler({
        httpMethod: 'GET',
        headers: { authorization: 'Bearer token-123' },
        body: null,
        rawQuery: 'action=pdf',
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toContain('link');
    });

    it('returns base64-encoded PDF response', async () => {
      const handler = await loadHandler();
      const pdfBytes = Buffer.from('%PDF-1.4 fake content');
      fetchMock.mockResolvedValue({
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(pdfBytes.buffer),
      });

      const response = await handler({
        httpMethod: 'GET',
        headers: { authorization: 'Bearer token-123' },
        body: null,
        rawQuery: 'action=pdf&link=https%3A%2F%2Flab.example.com%2Fpdf%2F1',
      });

      expect(response.statusCode).toBe(200);
      expect((response as Record<string, unknown>).isBase64Encoded).toBe(true);
      expect((response.headers as Record<string, string>)['Content-Type']).toBe('application/pdf');
    });

    it('returns 502 on proxy failure', async () => {
      const handler = await loadHandler();
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const response = await handler({
        httpMethod: 'GET',
        headers: { authorization: 'Bearer token-123' },
        body: null,
        rawQuery: 'action=pdf&link=https%3A%2F%2Flab.example.com%2Fpdf%2F1',
      });

      expect(response.statusCode).toBe(502);
    });
  });

  /* ── Timeout handling ────────────────────────────────────────────────── */

  it('returns 504 on fetch timeout (AbortError)', async () => {
    const consoleSpies = suppressConsole(['error']);
    const handler = await loadHandler();
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    try {
      const response = await handler({
        httpMethod: 'GET',
        headers: { authorization: 'Bearer token-123' },
        body: null,
        rawQuery: 'action=search&rut=12345678-9',
      });

      expect(response.statusCode).toBe(504);
      expect(response.body).toContain('Timeout');
    } finally {
      restoreConsole(consoleSpies);
    }
  });

  it('rejects unauthenticated requests before touching the upstream proxy', async () => {
    const handler = await loadHandler();
    extractBearerTokenMock.mockImplementation(() => {
      throw new Error('Missing Authorization bearer token.');
    });

    const response = await handler({
      httpMethod: 'GET',
      headers: {},
      body: null,
      rawQuery: 'action=search&rut=12345678-9',
    });

    expect(response.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unauthorized roles before touching the upstream proxy', async () => {
    const handler = await loadHandler();
    authorizeRoleRequestMock.mockRejectedValue(new Error("Access denied for role 'guest'."));

    const response = await handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer token-123', 'x-forwarded-for': '10.0.0.31' },
      body: null,
      rawQuery: 'action=search&rut=12345678-9',
    });

    expect(response.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows viewer users to query the upstream lab proxy', async () => {
    const handler = await loadHandler();
    authorizeRoleRequestMock.mockResolvedValue({
      email: 'viewer@hospital.cl',
      role: 'viewer',
    });
    fetchMock.mockResolvedValue({
      status: 200,
      json: vi.fn().mockResolvedValue({ exams: [] }),
    });

    const response = await handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer token-123', 'x-forwarded-for': '10.0.0.32' },
      body: null,
      rawQuery: 'action=search&rut=12345678-9',
    });

    expect(response.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });
});
