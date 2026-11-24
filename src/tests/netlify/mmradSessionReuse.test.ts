// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMMRADSearchHandler } from '../../../netlify/functions/mmrad-search';
import {
  forgetMMRADSession,
  isLoggedInRisPage,
  withMMRADSession,
  type LoginResult,
} from '../../../netlify/functions/lib/mmrad-session';
import { suppressProcessStdout, type RestorableSpy } from '@/tests/utils/consoleTestUtils';

const session = (name: string): LoginResult => ({
  cookies: `JSESSIONID=${name}`,
  searchActionUrl: 'https://ris.mmrad.cl/search',
});

describe('reusing the RIS session of a warm function', () => {
  beforeEach(() => forgetMMRADSession());
  afterEach(() => vi.useRealTimers());

  it('tells a logged-in results page from the login page', () => {
    expect(isLoggedInRisPage('<form><input name="_2_idpaciente" /></form><table></table>')).toBe(
      true
    );
    expect(isLoggedInRisPage('<form><input name="_58_login" /></form>')).toBe(false);
    expect(isLoggedInRisPage('<html><body>Bienvenido</body></html>')).toBe(false);
  });

  it('logs in once for consecutive requests and again after ten minutes', async () => {
    vi.useFakeTimers();
    const login = vi.fn(async () => session(`s${login.mock.calls.length}`));
    const work = vi.fn(async (current: LoginResult) => current.cookies);

    expect(await withMMRADSession(work, undefined, login)).toBe('JSESSIONID=s1');
    expect(await withMMRADSession(work, undefined, login)).toBe('JSESSIONID=s1');
    expect(login).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10 * 60_000);
    expect(await withMMRADSession(work, undefined, login)).toBe('JSESSIONID=s2');
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('repeats work that failed on a reused session once, after a fresh login', async () => {
    const login = vi.fn(async () => session(`s${login.mock.calls.length}`));
    await withMMRADSession(async () => 'warm', undefined, login);
    const work = vi.fn(async (current: LoginResult) => {
      if (current.cookies === 'JSESSIONID=s1') throw new Error('La sesión MMRAD no está activa.');
      return current.cookies;
    });

    expect(await withMMRADSession(work, undefined, login)).toBe('JSESSIONID=s2');
    expect(work).toHaveBeenCalledTimes(2);
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('does not keep a session whose work failed, nor retry a fresh failure or a cancellation', async () => {
    const login = vi.fn(async () => session(`s${login.mock.calls.length}`));
    const failing = vi.fn(async () => {
      throw new Error('synthetic failure');
    });
    await expect(withMMRADSession(failing, undefined, login)).rejects.toThrow('synthetic');
    expect(failing).toHaveBeenCalledTimes(1);
    await withMMRADSession(async () => 'ok', undefined, login);
    expect(login).toHaveBeenCalledTimes(2);

    const controller = new AbortController();
    controller.abort();
    await expect(withMMRADSession(failing, controller.signal, login)).rejects.toThrow('synthetic');
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('keeps no session when the login found no search form', async () => {
    const login = vi.fn(async () => ({ cookies: '', searchActionUrl: null }));
    await withMMRADSession(async () => 'empty', undefined, login);
    await withMMRADSession(async () => 'empty', undefined, login);
    expect(login).toHaveBeenCalledTimes(2);
  });
});

describe('reusing the RIS session across MMRAD document proxies', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let stdoutSpy: RestorableSpy;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const createHandler = () =>
    createMMRADSearchHandler({
      getFirebaseServer: vi.fn().mockReturnValue({ db: {} }),
      authorizeRoleRequest: vi.fn().mockResolvedValue({ role: 'doctor_urgency' }),
      extractBearerToken: vi.fn().mockReturnValue('synthetic-token'),
    });

  const queueLogin = (sessionCookie: string) => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          '<form action="https://ris.mmrad.cl/c/portal/login%2Flogin"><input name="_58_login" /></form>',
          { headers: { 'set-cookie': `JSESSIONID=${sessionCookie}; Path=/` } }
        )
      )
      .mockResolvedValueOnce(
        new Response('', { status: 302, headers: { location: '/group/hhangaroa' } })
      )
      .mockResolvedValueOnce(
        new Response(
          '<form action="https://ris.mmrad.cl/examenportlet/search"><input name="idpaciente" /></form>'
        )
      );
  };

  const loginRequests = () =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes('/web/guest/home')).length;

  const pdfEvent = (id: string) => ({
    httpMethod: 'GET',
    headers: {
      origin: 'https://app.example.com',
      authorization: 'Bearer synthetic-token',
      'x-forwarded-for': '10.1.0.10',
    },
    body: null,
    rawQuery: new URLSearchParams({
      action: 'pdf',
      link: `https://ris.mmrad.cl/informePDF/${id}`,
    }).toString(),
  });

  const receiptEvent = (id: string) => ({
    httpMethod: 'GET',
    headers: {
      origin: 'https://app.example.com',
      authorization: 'Bearer synthetic-token',
      'x-forwarded-for': '10.1.0.11',
    },
    body: null,
    rawQuery: new URLSearchParams({
      action: 'portalReceipt',
      link: `https://ris.mmrad.cl/web/portalpaciente/comprobante?idexamen=${id}`,
    }).toString(),
  });

  beforeEach(() => {
    forgetMMRADSession();
    vi.stubEnv('URL', 'https://app.example.com');
    vi.stubEnv('MMRAD_USERNAME', 'synthetic-user');
    vi.stubEnv('MMRAD_PASSWORD', 'synthetic-password');
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    stdoutSpy = suppressProcessStdout();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('logs in once across two consecutive PDF requests', async () => {
    const handler = createHandler();
    queueLogin('pdf-s1');
    fetchMock
      .mockResolvedValueOnce(
        new Response('%PDF-1.4\nfirst', { headers: { 'Content-Type': 'application/pdf' } })
      )
      .mockResolvedValueOnce(
        new Response('%PDF-1.4\nsecond', { headers: { 'Content-Type': 'application/pdf' } })
      );

    const first = await handler(pdfEvent('1'));
    const second = await handler(pdfEvent('2'));

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(loginRequests()).toBe(1);
    expect(Buffer.from(second.body, 'base64').toString()).toBe('%PDF-1.4\nsecond');
  });

  it('reuses the session warmed by an exam search when fetching a PDF next', async () => {
    const handler = createHandler();
    queueLogin('search-s1');
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          '<html><body><form><input name="idpaciente" /></form><table></table></body></html>'
        )
      )
      .mockResolvedValueOnce(
        new Response('%PDF-1.4\nafter-search', { headers: { 'Content-Type': 'application/pdf' } })
      );

    const search = await handler({
      httpMethod: 'GET',
      headers: {
        origin: 'https://app.example.com',
        authorization: 'Bearer synthetic-token',
        'x-forwarded-for': '10.1.0.12',
      },
      body: null,
      rawQuery: 'rut=12345678-9',
    });
    const pdf = await handler(pdfEvent('after-search'));

    expect(search.statusCode).toBe(200);
    expect(pdf.statusCode).toBe(200);
    expect(loginRequests()).toBe(1);
  });

  it('refreshes the session once and returns the PDF when a warm session receives login HTML', async () => {
    const handler = createHandler();
    queueLogin('stale-s1');
    fetchMock.mockResolvedValueOnce(new Response('%PDF-1.4\nwarm'));
    expect((await handler(pdfEvent('warm'))).statusCode).toBe(200);
    expect(loginRequests()).toBe(1);

    // Warm session expired: RIS answers 200 with login HTML instead of PDF bytes.
    fetchMock.mockResolvedValueOnce(
      new Response('<html><form><input name="_58_login" /></form></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })
    );
    queueLogin('fresh-s2');
    fetchMock.mockResolvedValueOnce(
      new Response('%PDF-1.4\nrecovered', { headers: { 'Content-Type': 'application/pdf' } })
    );

    const recovered = await handler(pdfEvent('recovered'));
    expect(recovered.statusCode).toBe(200);
    expect((recovered.headers as Record<string, string>)['Content-Type']).toBe('application/pdf');
    expect(Buffer.from(recovered.body, 'base64').toString()).toBe('%PDF-1.4\nrecovered');
    expect(loginRequests()).toBe(2);
  });

  it('refreshes the session once when a warm session answers the document with an error status', async () => {
    const handler = createHandler();
    queueLogin('status-s1');
    fetchMock.mockResolvedValueOnce(new Response('%PDF-1.4\nwarm'));
    expect((await handler(pdfEvent('warm'))).statusCode).toBe(200);

    fetchMock.mockResolvedValueOnce(new Response('denied', { status: 403 }));
    queueLogin('status-s2');
    fetchMock.mockResolvedValueOnce(new Response('%PDF-1.4\nrecovered'));

    const recovered = await handler(pdfEvent('recovered'));
    expect(recovered.statusCode).toBe(200);
    expect(Buffer.from(recovered.body, 'base64').toString()).toBe('%PDF-1.4\nrecovered');
    expect(loginRequests()).toBe(2);
  });

  it('never serves HTML as application/pdf and clears the session when both warm and fresh attempts return HTML', async () => {
    const handler = createHandler();
    queueLogin('warm-s1');
    fetchMock.mockResolvedValueOnce(new Response('%PDF-1.4\nok'));
    expect((await handler(pdfEvent('ok'))).statusCode).toBe(200);

    // Warm attempt returns login HTML, fresh login attempt also returns HTML.
    fetchMock.mockResolvedValueOnce(new Response('<html><input name="_58_login" /></html>'));
    queueLogin('bad-s2');
    fetchMock.mockResolvedValueOnce(new Response('<html><body>error page</body></html>'));

    const failed = await handler(pdfEvent('bad'));
    expect(failed.statusCode).toBe(502);
    expect((failed.headers as Record<string, string>)['Content-Type']).toContain(
      'application/json'
    );
    expect(failed.body).toContain('Error al obtener el PDF desde MMRAD');
    expect(loginRequests()).toBe(2);

    // Failed fresh login did not cache a broken session: next call logs in fresh.
    queueLogin('clean-s3');
    fetchMock.mockResolvedValueOnce(new Response('%PDF-1.4\nclean'));
    const clean = await handler(pdfEvent('clean'));
    expect(clean.statusCode).toBe(200);
    expect(loginRequests()).toBe(3);
  });

  it('returns 502 for an oversized PDF without triggering a second login', async () => {
    const handler = createHandler();
    queueLogin('warm-size');
    fetchMock.mockResolvedValueOnce(new Response('%PDF-1.4\nseed'));
    expect((await handler(pdfEvent('seed'))).statusCode).toBe(200);

    fetchMock.mockResolvedValueOnce(
      new Response('', {
        status: 200,
        headers: { 'Content-Length': String(20 * 1024 * 1024) },
      })
    );

    const oversized = await handler(pdfEvent('huge'));
    expect(oversized.statusCode).toBe(502);
    expect(oversized.body).toContain('tamaño máximo');
    expect(loginRequests()).toBe(1);
  });

  it('reuses the session for portal receipts without requiring idpaciente and refreshes on _58_login', async () => {
    const handler = createHandler();
    queueLogin('receipt-s1');
    fetchMock
      .mockResolvedValueOnce(new Response('<html><body>Datos del paciente</body></html>'))
      .mockResolvedValueOnce(new Response('<html><body>Comprobante 2</body></html>'));

    const first = await handler(receiptEvent('1'));
    const second = await handler(receiptEvent('2'));
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.body).toContain('Comprobante 2');
    expect(loginRequests()).toBe(1);

    // Expired session returns _58_login: triggers 1 fresh login and delivers the receipt.
    fetchMock.mockResolvedValueOnce(
      new Response('<html><form><input name="_58_login" /></form></html>')
    );
    queueLogin('receipt-s2');
    fetchMock.mockResolvedValueOnce(new Response('<html><body>Comprobante renovado</body></html>'));

    const renewed = await handler(receiptEvent('3'));
    expect(renewed.statusCode).toBe(200);
    expect(renewed.body).toContain('Comprobante renovado');
    expect(loginRequests()).toBe(2);
  });
});
