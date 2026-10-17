import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMMRADDicomHandler } from '../../../netlify/functions/mmrad-dicom';
import {
  loadVendorStudyMetadata,
  normalizeVendorStudy,
  sockJsMessages,
} from '../../../netlify/functions/lib/mmrad-dicom-metadata';
import {
  issueInstanceTicket,
  verifyInstanceTicket,
  validatedWadoServer,
  viewerStudyFromHtml,
  readBoundedResponse,
} from '../../../netlify/functions/lib/mmrad-dicom-policy';
import {
  syntheticDicom,
  syntheticVendorStudy,
  SYNTHETIC_STUDY_UID,
  SYNTHETIC_SERIES_UID,
  syntheticSopUid,
} from '../fixtures/syntheticDicom';

const authorize = vi
  .fn()
  .mockResolvedValue({ token: { sub: 'synthetic-user' }, role: 'doctor_urgency' });
const loadMetadata = vi.fn();
const handler = () =>
  createMMRADDicomHandler({
    authorizeRoleRequest: authorize,
    getFirebaseServer: vi.fn().mockReturnValue({ db: {} }),
    loadVendorStudyMetadata: loadMetadata,
  });
const event = (body: unknown, overrides = {}) => ({
  httpMethod: 'POST',
  headers: { origin: 'https://app.example.com', authorization: 'Bearer synthetic-token' },
  body: JSON.stringify(body),
  ...overrides,
});
const ticket = () =>
  issueInstanceTicket({
    subject: 'synthetic-user',
    study: SYNTHETIC_STUDY_UID,
    series: SYNTHETIC_SERIES_UID,
    sop: syntheticSopUid(0),
    server: 'synthetic',
  });

describe('protected MMRAD DICOM bridge', () => {
  beforeEach(() => {
    vi.stubEnv('MMRAD_PASSWORD', 'synthetic-test-secret');
    vi.stubEnv('URL', 'https://app.example.com');
    vi.clearAllMocks();
    authorize.mockResolvedValue({ token: { sub: 'synthetic-user' }, role: 'doctor_urgency' });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('rejects foreign origins, missing auth, denied roles and invalid requests before accessing the vendor', async () => {
    const run = handler();
    expect(
      (await run(event({}, { headers: { origin: 'https://foreign.example.com' } }))).statusCode
    ).toBe(403);
    expect((await run(event({}, { httpMethod: 'GET' }))).statusCode).toBe(405);
    expect((await run(event({}, { headers: {} }))).statusCode).toBe(401);
    authorize.mockRejectedValueOnce(new Error("Access denied for role 'unauthorized'."));
    expect((await run(event({ action: 'metadata' }))).statusCode).toBe(403);
    expect(
      (
        await run(
          event({ action: 'metadata', link: 'https://evil.example.com', patientId: '11.111.111-1' })
        )
      ).statusCode
    ).toBe(400);
    expect((await run(event({}, { body: '{broken' }))).statusCode).toBe(400);
    expect(
      (
        await run(
          event({
            action: 'metadata',
            link: 'https://ris.mmrad.cl/exam/synthetic',
            patientId: '11.111.111-2',
          })
        )
      ).statusCode
    ).toBe(400);
    expect(loadMetadata).not.toHaveBeenCalled();
  });

  it('keeps the requested document separate from the portal internal ID, without raw vendor URLs or cookies', async () => {
    loadMetadata.mockResolvedValue({ uid: SYNTHETIC_STUDY_UID, metadata: syntheticVendorStudy(3) });
    const response = await handler()(
      event({
        action: 'metadata',
        link: 'https://ris.mmrad.cl/exam/synthetic',
        patientId: '11.111.111-1',
      })
    );
    expect(response.statusCode).toBe(200);
    expect((response.headers as Record<string, string>)['Cache-Control']).toBe('no-store');
    const study = JSON.parse(response.body);
    expect(study.patientId).toBe('111111111');
    expect(response.body).not.toContain('synthetic-internal-portal-id');
    expect(study.series[0].instances).toHaveLength(3);
    expect(response.body).not.toContain('wadouri');
    expect(response.body).not.toContain('172.16.');
    expect(verifyInstanceTicket(study.series[0].instances[0].ticket, 'synthetic-user').study).toBe(
      SYNTHETIC_STUDY_UID
    );
    expect(() =>
      normalizeVendorStudy(syntheticVendorStudy(), SYNTHETIC_STUDY_UID, '', 'synthetic-user')
    ).toThrow('paciente');
  });

  it('rejects modified, expired and cross-user capabilities before making an image request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const run = handler();
    const value = ticket();
    expect(() => verifyInstanceTicket(value, 'other-user')).toThrow();
    expect((await run(event({ action: 'instance', ticket: `${value}x` }))).statusCode).toBe(403);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 60_000);
    expect((await run(event({ action: 'instance', ticket: value }))).statusCode).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies only the fixed HTTPS WADO destination, with no RIS credentials and no caching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(syntheticDicom(0)));
    vi.stubGlobal('fetch', fetchMock);
    const response = await handler()(event({ action: 'instance', ticket: ticket() }));
    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('application/dicom');
    expect((response.headers as Record<string, string>)['Cache-Control']).toBe('no-store');
    const [url, options] = fetchMock.mock.calls[0];
    expect(new URL(url).origin).toBe('https://hhangaroavisor.mmrad.cl:4446');
    expect(options.redirect).toBe('error');
    expect(options.headers.Cookie).toBeUndefined();
    expect(Buffer.from(response.body, 'base64').subarray(128, 132).toString()).toBe('DICM');
  });

  it('rejects foreign or mismatched nested WADO URLs, duplicate instances and oversized streams', async () => {
    const study = syntheticVendorStudy(3);
    const instance = study.seriesList[0].instances[0];
    expect(() =>
      validatedWadoServer(
        instance.wadouri.replace('hhangaroavisor.mmrad.cl', 'evil.example.com'),
        SYNTHETIC_STUDY_UID,
        SYNTHETIC_SERIES_UID,
        instance.sopInstanceUid
      )
    ).toThrow();
    expect(() =>
      validatedWadoServer(
        instance.wadouri,
        SYNTHETIC_STUDY_UID,
        SYNTHETIC_SERIES_UID,
        syntheticSopUid(4)
      )
    ).toThrow();
    study.seriesList[0].instances[1] = instance;
    expect(() =>
      normalizeVendorStudy(study, SYNTHETIC_STUDY_UID, '11111111-1', 'synthetic-user')
    ).toThrow('duplicada');
    await expect(readBoundedResponse(new Response(new Uint8Array(10)), 5)).rejects.toThrow(
      'tamaño'
    );
    expect(() =>
      viewerStudyFromHtml('<iframe src="https://evil.example.com/viewer/1.2.3"></iframe>')
    ).toThrow();
    expect(sockJsMessages('o\na["{\\"msg\\":\\"connected\\"}"]\nh')).toEqual([
      { msg: 'connected' },
    ]);
  });

  it('performs the observed SockJS/DDP handshake, accepts 204 sends and answers heartbeats', async () => {
    vi.stubEnv('MMRAD_USERNAME', 'synthetic');
    const frame = (messages: object[]) =>
      `a${JSON.stringify(messages.map(message => JSON.stringify(message)))}`;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('<form action="https://ris.mmrad.cl/login%2Flogin"></form>')
      )
      .mockResolvedValueOnce(new Response('', { status: 302, headers: { location: '/redirect' } }))
      .mockResolvedValueOnce(
        new Response('', { status: 302, headers: { location: '/group/hhangaroa' } })
      )
      .mockResolvedValueOnce(
        new Response('<form action="https://ris.mmrad.cl/examenportlet/search"></form>')
      )
      .mockResolvedValueOnce(
        new Response(
          `<iframe src="https://hhangaroavisor.mmrad.cl:4446/viewer/${SYNTHETIC_STUDY_UID}"></iframe>`
        )
      )
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('o'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(frame([{ msg: 'connected' }])))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(
          frame([{ msg: 'ping' }, { msg: 'result', id: '1', result: syntheticVendorStudy(3) }])
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await loadVendorStudyMetadata(
      'https://ris.mmrad.cl/exam/synthetic',
      AbortSignal.timeout(1000)
    );
    expect(result.uid).toBe(SYNTHETIC_STUDY_UID);
    expect(result.metadata).toEqual(syntheticVendorStudy(3));
    for (const [, options] of fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('hhangaroavisor')
    )) {
      expect(options.headers.Cookie).toBeUndefined();
      expect(options.redirect).toBe('error');
    }
  });
});
