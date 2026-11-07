import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  restoreConsole,
  type RestorableSpy,
  suppressConsole,
  suppressProcessStdout,
} from '@/tests/utils/consoleTestUtils';

describe('mmrad-search', () => {
  const originalEnv = { ...process.env };
  const fetchMock = vi.fn();
  const getFirebaseServerMock = vi.fn();
  const authorizeRoleRequestMock = vi.fn();
  const extractBearerTokenMock = vi.fn();
  let stdoutSpy: RestorableSpy;
  const loadHandler = async () => {
    const { createMMRADSearchHandler } = await import('../../../netlify/functions/mmrad-search');
    return createMMRADSearchHandler({
      getFirebaseServer: getFirebaseServerMock as typeof getFirebaseServerMock,
      authorizeRoleRequest: authorizeRoleRequestMock as typeof authorizeRoleRequestMock,
      extractBearerToken: extractBearerTokenMock as typeof extractBearerTokenMock,
    });
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { forgetMMRADSession } = await import('../../../netlify/functions/lib/mmrad-session');
    forgetMMRADSession();
    process.env = {
      ...originalEnv,
      URL: 'https://app.example.com',
      DEPLOY_PRIME_URL: '',
      DEPLOY_URL: '',
      SITE_URL: '',
      APP_URL: '',
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
    stdoutSpy = suppressProcessStdout();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    process.env = originalEnv;
    vi.unstubAllGlobals();
    vi.useRealTimers();
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
  });

  it('returns 405 for non-GET methods', async () => {
    const handler = await loadHandler();
    const response = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: null,
      rawQuery: 'rut=12345678-9',
    });

    expect(response.statusCode).toBe(405);
    expect(response.body).toContain('Method not allowed');
  });

  it('returns 400 when rut is missing', async () => {
    const handler = await loadHandler();
    const response = await handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer token-123' },
      body: null,
      rawQuery: '',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('RUT');
  });

  it('returns a clearer 403 when the caller has no authorized MMRAD role', async () => {
    const handler = await loadHandler();
    authorizeRoleRequestMock.mockRejectedValue(new Error("Access denied for role 'unauthorized'."));

    const response = await handler({
      httpMethod: 'GET',
      headers: {
        authorization: 'Bearer token-123',
        origin: 'https://app.example.com',
        'x-forwarded-for': '10.0.0.21',
      },
      body: null,
      rawQuery: 'rut=12345678-9',
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toContain('Acceso denegado para MMRAD');
    expect(response.body).toContain('config/roles');
  });

  it('allows viewer users to query MMRAD', async () => {
    const handler = await loadHandler();
    authorizeRoleRequestMock.mockResolvedValue({
      email: 'viewer@hospital.cl',
      role: 'viewer',
    });

    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('<html><body>No login form here</body></html>'),
    });

    const response = await handler({
      httpMethod: 'GET',
      headers: {
        authorization: 'Bearer token-123',
        origin: 'https://app.example.com',
        'x-forwarded-for': '10.0.0.23',
      },
      body: null,
      rawQuery: 'rut=12345678-9',
    });

    expect(response.statusCode).toBe(500);
    expect(authorizeRoleRequestMock).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('reports a missing search form as failure instead of an empty patient history', async () => {
    const handler = await loadHandler();
    // Step 1: GET home page — no login form in HTML
    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('<html><body>No login form here</body></html>'),
    });

    const response = await handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer token-123', 'x-forwarded-for': '10.0.0.22' },
      body: null,
      rawQuery: 'rut=12345678-9',
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.examenes).toBeUndefined();
    expect(body.error).toContain('sesión');
    expect(body._debug).toBeUndefined();
  });

  it('handles successful search flow with exam results', async () => {
    const handler = await loadHandler();
    const loginActionUrl =
      'https://ris.mmrad.cl/c/portal/login%2Flogin;jsessionid=abc123?p_l_id=123';
    const dashboardUrl = '/group/hhangaroa';
    const searchActionUrl = 'https://ris.mmrad.cl/examenportlet_WAR_portlet/search?p_l_id=456';

    // Step 1: GET home page — returns HTML with login form
    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
      text: vi
        .fn()
        .mockResolvedValue(
          `<html><form action="${loginActionUrl}" method="post"><input name="_58_login"/></form></html>`
        ),
    });

    // Step 2: POST login credentials — 302 redirect
    fetchMock.mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: '/c/portal/redirect' }),
      text: vi.fn().mockResolvedValue(''),
    });

    // Step 3: Follow first redirect — 302 to dashboard
    fetchMock.mockResolvedValueOnce({
      status: 302,
      headers: new Headers({ location: dashboardUrl }),
      text: vi.fn().mockResolvedValue(''),
    });

    // Step 4: Follow second redirect — dashboard with search form
    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue(
        `<html><body>
          <form action="${searchActionUrl}" method="post">
            <input name="idpaciente" />
          </form>
        </body></html>`
      ),
    });

    // Step 5: POST search — exam results table
    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue(
        `<html><body><form><input name="idpaciente" /></form><table>
          <tr>
            <td>0</td><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td>
            <td>01/01/2026</td><td>02/01/2026</td><td>8</td><td>9</td>
            <td>TC Torax</td><td>CT</td><td>12</td><td>Informado</td>
            <td>Acciones</td>
            <td><a href="/informePDF/123">PDF</a></td>
            <td><a href="javascript:window.open('/ingrad-ris-informehtml/UtilServlet?a=1&id=123');void(0);">HTML</a></td>
            <td><a href="javascript:window.open('/web/portalpaciente/comprobante?idexamen=123&idprestacion=456');void(0);">Comprobante Portal Web paciente</a></td>
            <td><a href="javascript:window.open('/ingrad-ris-informehtml/UtilServlet?a=3&u=1&idexamen=123&idprestacion=0');void(0);">Visualizador DICOM HTML5</a></td>
            <td><a href="javascript:window.open('https://ris.mmrad.cl/group/hhangaroa/examenes?p_p_id=2_WAR_ingradteleradexamenportlet_INSTANCE_Ab12&amp;p_p_state=exclusive&amp;_2_WAR_ingradteleradexamenportlet_INSTANCE_Ab12__spage=%2Fportlet_action%2Fexamen%2Fabrirestudio&amp;_2_WAR_ingradteleradexamenportlet_INSTANCE_Ab12_idexamen=123');void(0);">Visualizador Universitas</a></td>
          </tr>
        </table></body></html>`
      ),
    });

    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue(
        `<html><body>
          <h1>TOMOGRAFÍA SIMPLE DE TÓRAX</h1>
          <p><strong>HALLAZGOS:</strong></p>
          <p>Parénquima pulmonar sin consolidaciones.</p>
          <p><strong>IMPRESION:</strong></p>
          <p>Cardiomegalia.</p>
        </body></html>`
      ),
    });

    const response = await handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer token-123' },
      body: null,
      rawQuery: 'rut=12.345.678-9',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.rut).toBe('12345678-9');
    expect(body.examenes).toBeInstanceOf(Array);
    expect(body.examenes[0].informe_html_url).toContain('/ingrad-ris-informehtml/UtilServlet?a=1');
    expect(body.examenes[0].portal_web_receipt_url).toBe(
      'https://ris.mmrad.cl/web/portalpaciente/comprobante?idexamen=123&idprestacion=456'
    );
    // MMRAD's current viewer wins over the legacy HTML5 one when the row offers both.
    expect(body.examenes[0].dicom_url).toBe(
      'https://ris.mmrad.cl/group/hhangaroa/examenes?p_p_id=2_WAR_ingradteleradexamenportlet_INSTANCE_Ab12&p_p_state=exclusive&_2_WAR_ingradteleradexamenportlet_INSTANCE_Ab12__spage=%2Fportlet_action%2Fexamen%2Fabrirestudio&_2_WAR_ingradteleradexamenportlet_INSTANCE_Ab12_idexamen=123'
    );
    expect(body.examenes[0].report.findings).toContain('Parénquima pulmonar');
    expect(body.examenes[0].report.impression).toContain('Cardiomegalia');
    expect(body._debug).toBeUndefined();
  });

  it.each([
    { query: '', from: '01/01/1900', to: '07/11/2026' },
    { query: '&from=2026-10-01', from: '01/10/2026', to: '07/11/2026' },
    { query: '&from=2026-09-01&to=2026-10-31', from: '01/09/2026', to: '31/10/2026' },
    { query: '&to=2026-10-31', from: '01/01/1900', to: '31/10/2026' },
  ])('reads icon-only study rows and sends explicit RIS calendar bounds: $query', async dates => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-08T02:30:00Z'));
    const handler = await loadHandler();
    fetchMock.mockResolvedValueOnce(
      new Response(
        '<form action="https://ris.mmrad.cl/examenportlet/search"><input name="idpaciente" /></form>'
      )
    );
    const row = (name: string, actions: string) => `<tr class="results-row">
      <td>0</td><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td>
      <td>01/11/2026</td><td>02/11/2026</td><td>12345678-9</td><td>PACIENTE SINTETICO</td>
      <td>${name}</td><td>CR</td><td>12</td><td>Pendiente</td><td>${actions}</td></tr>`;
    fetchMock.mockResolvedValueOnce(
      new Response(`<form><input name="idpaciente" /></form><table>
      <tr><td>Acciones de navegación</td></tr>
      <tr>${Array.from({ length: 15 }, () => '<td></td>').join('')}</tr>
      ${row('Rx sintética', '<a href="javascript:window.open(\'/ingrad-ris-informehtml/UtilServlet?a=3&amp;idexamen=123\')"><img alt="Abrir" /></a>')}
      ${row('Rx pendiente sin enlaces', '')}
      </table>`)
    );
    const response = await handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer token-123' },
      body: null,
      rawQuery: `rut=12345678-9${dates.query}`,
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.examenes.map((exam: { nombre_examen: string }) => exam.nombre_examen)).toEqual([
      'Rx sintética',
      'Rx pendiente sin enlaces',
    ]);
    expect(body.examenes[0].dicom_url).toBe(
      'https://ris.mmrad.cl/ingrad-ris-informehtml/UtilServlet?a=3&idexamen=123'
    );
    const request = fetchMock.mock.calls[1]?.[1];
    const params = new URLSearchParams(typeof request?.body === 'string' ? request.body : '');
    expect(params.get('fechaexamendesde')).toBe(dates.from);
    expect(params.get('fechaexamenhasta')).toBe(dates.to);
  });

  it('normalizes javascript report URLs returned inline by MMRAD', async () => {
    const handler = await loadHandler();
    const loginActionUrl =
      'https://ris.mmrad.cl/c/portal/login%2Flogin;jsessionid=abc123?p_l_id=123';
    const dashboardUrl = '/group/hhangaroa';
    const searchActionUrl = 'https://ris.mmrad.cl/examenportlet_WAR_portlet/search?p_l_id=456';

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
      headers: new Headers({ location: dashboardUrl }),
      text: vi.fn().mockResolvedValue(''),
    });
    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue(
        `<html><body>
          <form action="${searchActionUrl}" method="post">
            <input name="idpaciente" />
          </form>
        </body></html>`
      ),
    });
    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue(
        `<html><body><form><input name="idpaciente" /></form><table>
          <tr>
            <td>0</td><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td>
            <td>01/01/2026</td><td>02/01/2026</td><td>8</td><td>9</td>
            <td>TC Torax</td><td>CT</td><td>12</td><td>Informado</td>
            <td>Acciones</td>
            <td>
              <a href="javascript:window.open('/ingrad-ris-informehtml/UtilServlet?a=1&u=269958&idexamen=1459869&idprestacion=202609');void(0);">HTML</a>
            </td>
          </tr>
        </table></body></html>`
      ),
    });
    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue(
        `<html><body>
          <h1>TOMOGRAFÍA SIMPLE DE TÓRAX</h1>
          <p><strong>HALLAZGOS:</strong></p>
          <p>Hallazgos de prueba.</p>
          <p><strong>IMPRESION:</strong></p>
          <p>Impresión de prueba.</p>
        </body></html>`
      ),
    });

    const response = await handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer token-123' },
      body: null,
      rawQuery: 'rut=12.345.678-9',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.examenes[0].informe_html_url).toBe(
      'https://ris.mmrad.cl/ingrad-ris-informehtml/UtilServlet?a=1&u=269958&idexamen=1459869&idprestacion=202609'
    );
    expect(body.examenes[0].report.findings).toContain('Hallazgos de prueba');
    expect(body.examenes[0].report.impression).toContain('Impresión de prueba');
  });

  it('returns 500 when MMRAD credentials are not configured', async () => {
    const consoleSpies = suppressConsole(['error']);
    const handler = await loadHandler();
    delete process.env.MMRAD_USERNAME;
    delete process.env.MMRAD_PASSWORD;

    try {
      const response = await handler({
        httpMethod: 'GET',
        headers: { authorization: 'Bearer token-123' },
        body: null,
        rawQuery: 'rut=12345678-9',
      });

      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('MMRAD_USERNAME');
    } finally {
      restoreConsole(consoleSpies);
    }
  });

  it('proxies PDFs inline for preview/print when action=pdf is requested', async () => {
    const handler = await loadHandler();
    const loginActionUrl =
      'https://ris.mmrad.cl/c/portal/login%2Flogin;jsessionid=abc123?p_l_id=123';
    const dashboardUrl = '/group/hhangaroa';

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
      headers: new Headers({ location: dashboardUrl }),
      text: vi.fn().mockResolvedValue(''),
    });
    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers(),
      text: vi.fn().mockResolvedValue('<html><body>dashboard</body></html>'),
    });
    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/pdf' }),
      arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4]).buffer),
    });

    const response = await handler({
      httpMethod: 'GET',
      headers: { origin: 'https://app.example.com' },
      body: null,
      rawQuery:
        'action=pdf&link=' +
        encodeURIComponent('https://ris.mmrad.cl/informePDF?id=1459869&idprestacion=202609'),
    });

    const pdfResponse = response as typeof response & { isBase64Encoded?: boolean };

    expect(pdfResponse.statusCode).toBe(200);
    expect((pdfResponse.headers as Record<string, string>)['Content-Type']).toBe('application/pdf');
    expect((pdfResponse.headers as Record<string, string>)['Content-Disposition']).toContain(
      'inline'
    );
    expect(pdfResponse.isBase64Encoded).toBe(true);
    expect(pdfResponse.body).toBe(Buffer.from([1, 2, 3, 4]).toString('base64'));
  });

  it('returns 500 on fetch error', async () => {
    const consoleSpies = suppressConsole(['error']);
    const handler = await loadHandler();
    fetchMock.mockRejectedValue(new Error('Network error'));

    try {
      const response = await handler({
        httpMethod: 'GET',
        headers: { authorization: 'Bearer token-123' },
        body: null,
        rawQuery: 'rut=12345678-9',
      });

      expect(response.statusCode).toBe(500);
      expect(response.body).toContain('Network error');
    } finally {
      restoreConsole(consoleSpies);
    }
  });

  it('rejects unauthenticated requests before reaching MMRAD', async () => {
    const handler = await loadHandler();
    extractBearerTokenMock.mockImplementation(() => {
      throw new Error('Missing Authorization bearer token.');
    });

    const response = await handler({
      httpMethod: 'GET',
      headers: {},
      body: null,
      rawQuery: 'rut=12345678-9',
    });

    expect(response.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unauthorized roles before reaching MMRAD', async () => {
    const handler = await loadHandler();
    authorizeRoleRequestMock.mockRejectedValue(new Error("Access denied for role 'guest'."));

    const response = await handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer token-123', 'x-forwarded-for': '10.0.0.24' },
      body: null,
      rawQuery: 'rut=12345678-9',
    });

    expect(response.statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
