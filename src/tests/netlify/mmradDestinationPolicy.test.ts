import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMMRADSearchHandler } from '../../../netlify/functions/mmrad-search';
import { suppressProcessStdout, type RestorableSpy } from '@/tests/utils/consoleTestUtils';

describe('MMRAD destination policy', () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();
  let stdoutSpy: RestorableSpy;
  let requestId = 0;
  const handler = createMMRADSearchHandler({
    getFirebaseServer: vi.fn().mockReturnValue({ db: {} }),
    authorizeRoleRequest: vi.fn().mockResolvedValue({ role: 'doctor_urgency' }),
    extractBearerToken: vi.fn().mockReturnValue('synthetic-token'),
  });
  const request = (action: string, link: string) =>
    handler({
      httpMethod: 'GET',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer synthetic-token',
        'x-forwarded-for': `192.0.2.${++requestId}`,
      },
      body: null,
      rawQuery: new URLSearchParams({ action, link }).toString(),
    });
  const mockLogin = () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response('<form action="https://ris.mmrad.cl/c/portal/login%2Flogin"></form>')
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: '/redirect' } })
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: '/group/hhangaroa' } })
      )
      .mockResolvedValueOnce(
        new Response('dashboard', { headers: { 'set-cookie': 'SESSION=synthetic; Path=/' } })
      );
  };

  beforeEach(() => {
    fetchMock.mockReset();
    process.env = {
      ...originalEnv,
      URL: 'https://app.example.com',
      MMRAD_USERNAME: 'synthetic-user',
      MMRAD_PASSWORD: 'synthetic-password',
    };
    vi.stubGlobal('fetch', fetchMock);
    stdoutSpy = suppressProcessStdout();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
    stdoutSpy.mockRestore();
  });

  describe.each(['pdf', 'portalReceipt'])('%s', action => {
    it.each([
      '',
      'https://example.invalid/report',
      '//example.invalid/report',
      'https://ris.mmrad.cl.example.invalid/report',
      'https://ris.mmrad.cl@example.invalid/report',
      'https://user:pass@ris.mmrad.cl/report',
      'http://ris.mmrad.cl/report',
      'https://ris.mmrad.cl:444/report',
      'javascript:alert(1)',
    ])('rejects %s before any network call', async link => {
      const response = await request(action, link);
      expect(response.statusCode).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['/report', 'https://ris.mmrad.cl/report', "javascript:window.open('/report')"])(
      'preserves a valid institutional link: %s',
      async link => {
        mockLogin();
        fetchMock.mockResolvedValueOnce(new Response('synthetic content'));
        const response = await request(action, link);
        expect(response.statusCode).toBe(200);
        expect(fetchMock).toHaveBeenLastCalledWith(
          'https://ris.mmrad.cl/report',
          expect.objectContaining({
            redirect: 'manual',
            headers: expect.objectContaining({ Cookie: 'SESSION=synthetic' }),
          })
        );
      }
    );

    it('rejects an external redirect without forwarding the cookie', async () => {
      mockLogin();
      fetchMock.mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://example.invalid/report' } })
      );
      const response = await request(action, '/report');
      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Destino MMRAD no permitido');
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(
        fetchMock.mock.calls.every(([url]) => new URL(url).origin === 'https://ris.mmrad.cl')
      ).toBe(true);
    });

    it('follows relative redirects within MMRAD', async () => {
      mockLogin();
      fetchMock
        .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'final' } }))
        .mockResolvedValueOnce(new Response('synthetic content'));
      const response = await request(action, '/folder/report');
      expect(response.statusCode).toBe(200);
      expect(fetchMock).toHaveBeenLastCalledWith(
        'https://ris.mmrad.cl/folder/final',
        expect.objectContaining({
          headers: expect.objectContaining({ Cookie: 'SESSION=synthetic' }),
        })
      );
    });

    it('bounds redirect loops', async () => {
      mockLogin();
      fetchMock.mockImplementation(
        async () => new Response(null, { status: 302, headers: { location: '/report' } })
      );
      const response = await request(action, '/report');
      expect(response.statusCode).toBe(500);
      expect(fetchMock).toHaveBeenCalledTimes(10);
    });
  });

  it('rejects an external login redirect before sending credentials or cookies to it', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response('<form action="https://ris.mmrad.cl/c/portal/login%2Flogin"></form>')
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://example.invalid/login' } })
      );
    const response = await request('pdf', '/report');
    expect(response.statusCode).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
