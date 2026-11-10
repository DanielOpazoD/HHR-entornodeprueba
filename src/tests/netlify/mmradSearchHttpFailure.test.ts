import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMMRADSearchHandler } from '../../../netlify/functions/mmrad-search';
import { forgetMMRADSession } from '../../../netlify/functions/lib/mmrad-session';
import { suppressProcessStdout, type RestorableSpy } from '@/tests/utils/consoleTestUtils';

const searchAction = 'https://ris.mmrad.cl/examenportlet/search';
const searchForm = `<form action="${searchAction}"><input name="idpaciente" /></form>`;
const emptyResults = `<html><body>${searchForm}<table></table></body></html>`;
const loginPage = '<form><input name="_58_login" /></form>';
const maintenance = '<html><body>Servicio en mantenimiento</body></html>';
const ctResults = `<html><body>${searchForm}<table><tr>
  <td>0</td><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td>
  <td>01/01/2026</td><td>02/01/2026</td><td>11111111-1</td><td>Persona Sintética</td>
  <td>TC sintético</td><td>CT</td><td>12</td><td>Informado</td>
  <td><a href="/ingrad-ris-informehtml/UtilServlet?a=1&id=synthetic">HTML</a></td>
</tr></table></body></html>`;

describe('MMRAD search portal failures versus empty results', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let stdoutSpy: RestorableSpy;
  let client = 0;

  const dependencies = {
    getFirebaseServer: vi.fn(),
    authorizeRoleRequest: vi.fn(),
    extractBearerToken: vi.fn(),
  };
  const handler = createMMRADSearchHandler(dependencies);

  const request = () =>
    handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer synthetic', 'x-forwarded-for': `192.0.2.${++client}` },
      rawQuery: 'rut=11111111-1',
      body: null,
    });

  beforeEach(() => {
    dependencies.getFirebaseServer.mockReturnValue({ db: null });
    dependencies.authorizeRoleRequest.mockResolvedValue({ role: 'viewer' });
    dependencies.extractBearerToken.mockReturnValue('synthetic');
    forgetMMRADSession();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('MMRAD_USERNAME', 'synthetic-user');
    vi.stubEnv('MMRAD_PASSWORD', 'synthetic-password');
    stdoutSpy = suppressProcessStdout();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // Route by URL, returning a fresh Response on every attempt, including existing retries.
  const serveSearch = (status: number, html: string) => {
    fetchMock.mockImplementation(async url => {
      if (String(url) === searchAction) return new Response(html, { status });
      return new Response(emptyResults);
    });
  };

  it.each([
    [500, maintenance],
    [503, maintenance],
    [500, `<html><body>${searchForm}<p>Error del portal</p></body></html>`],
    [502, `<html><body>${searchForm}<p>Error del portal</p></body></html>`],
    [503, `<html><body>${searchForm}<p>Error del portal</p></body></html>`],
    [200, loginPage],
    [200, maintenance],
  ])('returns an error for HTTP %i and page %s', async (status, html) => {
    serveSearch(status, html);
    const response = await request();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === searchAction)).toBe(true);
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ error: expect.any(String) });
  });

  it('preserves a genuinely empty results page as a successful empty history', async () => {
    serveSearch(200, emptyResults);
    const response = await request();
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ rut: '11111111-1', examenes: [] });
  });

  it.each(['http', 'network'])(
    'keeps the CT exam when its optional report fails (%s)',
    async failure => {
      fetchMock.mockImplementation(async url => {
        if (String(url) === searchAction) return new Response(ctResults);
        if (String(url).includes('UtilServlet')) {
          if (failure === 'network') throw new Error('Synthetic network failure');
          return new Response(maintenance, { status: 503 });
        }
        return new Response(emptyResults);
      });
      const response = await request();
      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).examenes).toEqual([
        expect.objectContaining({ nombre_examen: 'TC sintético', report: null }),
      ]);
    }
  );
});
