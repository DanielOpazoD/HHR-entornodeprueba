import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMMRADSearchHandler } from '../../../netlify/functions/mmrad-search';

describe('MMRAD document telemetry', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const securedHandler = () =>
    createMMRADSearchHandler({
      getFirebaseServer: vi.fn().mockReturnValue({ db: {} }),
      authorizeRoleRequest: vi.fn().mockResolvedValue({ role: 'doctor_urgency' }),
      extractBearerToken: vi.fn().mockReturnValue('synthetic-token'),
    });

  beforeEach(() => {
    vi.stubEnv('URL', 'https://app.example.com');
    vi.stubEnv('MMRAD_USERNAME', 'synthetic-user');
    vi.stubEnv('MMRAD_PASSWORD', 'synthetic-password');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe.each([
    { action: 'pdf', operation: 'pdf_proxy', error: 'Error al obtener el PDF desde MMRAD' },
    {
      action: 'portalReceipt',
      operation: 'portal_receipt_proxy',
      error: 'Error al obtener el comprobante portal desde MMRAD',
    },
  ])('$action', ({ action, operation, error }) => {
    it.each([200, 503])(
      'classifies upstream %s without changing the response or retrying',
      async status => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        // An already authenticated portal page, followed by the document response.
        fetchMock
          .mockResolvedValueOnce(new Response('<html>synthetic dashboard</html>'))
          .mockResolvedValueOnce(new Response('synthetic document body', { status }));
        const response = await securedHandler()({
          httpMethod: 'GET',
          headers: { origin: 'https://app.example.com', authorization: 'Bearer synthetic-token' },
          body: null,
          rawQuery: new URLSearchParams({
            action,
            link: 'https://ris.mmrad.cl/synthetic-document',
          }).toString(),
        });

        expect(response.statusCode).toBe(status === 200 ? 200 : 502);
        expect(response.body).toBe(
          status !== 200
            ? JSON.stringify({ error })
            : action === 'pdf'
              ? Buffer.from('synthetic document body').toString('base64')
              : 'synthetic document body'
        );
        expect(response.headers).toMatchObject({
          'Access-Control-Allow-Origin': 'https://app.example.com',
          'Content-Type':
            status !== 200
              ? 'application/json; charset=utf-8'
              : action === 'pdf'
                ? 'application/pdf'
                : 'text/html; charset=utf-8',
        });
        if (status === 200 && action === 'pdf') {
          expect(response).toMatchObject({ isBase64Encoded: true });
        }
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const logs = [...errors.mock.calls, ...output.mock.calls].map(([entry]) => String(entry));
        expect(logs).toHaveLength(1);
        expect(JSON.parse(logs[0])).toMatchObject({
          service: 'mmrad',
          operation,
          status: status === 200 ? 'success' : 'failure',
          ...(status !== 200 ? { willRetry: false, errorCode: 'FAILURE_RESULT' } : {}),
        });
        expect(logs[0]).not.toContain('synthetic document body');
        expect(logs[0]).not.toContain('synthetic-password');
        expect(logs[0]).not.toContain('synthetic-token');
      }
    );

    it('rejects an invalid caller link with 400 before invoking the service', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
      const response = await securedHandler()({
        httpMethod: 'GET',
        headers: { authorization: 'Bearer synthetic-token' },
        body: null,
        rawQuery: new URLSearchParams({
          action,
          link: 'https://invalid.example/document',
        }).toString(),
      });
      expect(response.statusCode).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(errors).not.toHaveBeenCalled();
      expect(output).not.toHaveBeenCalled();
    });
  });
});
