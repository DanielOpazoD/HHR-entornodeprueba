import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type RestorableSpy, suppressProcessStdout } from '@/tests/utils/consoleTestUtils';

describe('mmrad-search study rows and calendar bounds', () => {
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
});
