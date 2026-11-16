// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('mmrad portal receipt proxy', () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();
  const getFirebaseServerMock = vi.fn();
  const authorizeRoleRequestMock = vi.fn();
  const extractBearerTokenMock = vi.fn();

  const loadHandler = async () => {
    const { createMMRADSearchHandler } = await import('../../../netlify/functions/mmrad-search');
    return createMMRADSearchHandler({
      getFirebaseServer: getFirebaseServerMock as typeof getFirebaseServerMock,
      authorizeRoleRequest: authorizeRoleRequestMock as typeof authorizeRoleRequestMock,
      extractBearerToken: extractBearerTokenMock as typeof extractBearerTokenMock,
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      URL: 'https://app.example.com',
      MMRAD_USERNAME: 'testuser',
      MMRAD_PASSWORD: 'testpass',
    };
    vi.stubGlobal('fetch', fetchMock);
    getFirebaseServerMock.mockReturnValue({ db: { kind: 'firestore' } });
    authorizeRoleRequestMock.mockResolvedValue({
      email: 'doctor@hospital.cl',
      role: 'doctor_urgency',
    });
    extractBearerTokenMock.mockReturnValue('token-123');
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it('proxies portal web receipt HTML for browser print/save-as-pdf', async () => {
    const handler = await loadHandler();
    const loginActionUrl =
      'https://ris.mmrad.cl/c/portal/login%2Flogin;jsessionid=abc123?p_l_id=123';

    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
      text: vi
        .fn()
        .mockResolvedValue(
          `<html><form action="${loginActionUrl}" method="post"><input name="_58_login"/></form></html>`
        ),
    });
    fetchMock.mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: '/c/portal/redirect' }),
      text: vi.fn().mockResolvedValue(''),
    });
    fetchMock.mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: '/group/hhangaroa' }),
      text: vi.fn().mockResolvedValue(''),
    });
    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('<html><body>dashboard</body></html>'),
    });
    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers({ 'Content-Type': 'text/html; charset=ISO-8859-1' }),
      arrayBuffer: vi
        .fn()
        .mockResolvedValue(Buffer.from('<html><body>Datos del paciente</body></html>', 'latin1')),
    });

    const response = await handler({
      httpMethod: 'GET',
      headers: { origin: 'https://app.example.com' },
      body: null,
      rawQuery:
        'action=portalReceipt&link=' +
        encodeURIComponent(
          'https://ris.mmrad.cl/web/portalpaciente/comprobante?idexamen=123&idprestacion=456'
        ),
    });

    expect(response.statusCode).toBe(200);
    expect((response.headers as Record<string, string>)['Content-Type']).toContain('text/html');
    expect(response.body).toContain('Datos del paciente');
    expect(response.body).not.toContain('base64');
  });
});
