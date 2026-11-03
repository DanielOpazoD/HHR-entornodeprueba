import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMMRADDicomHandler } from '../../../netlify/functions/mmrad-dicom';
import {
  isUniversitasLink,
  normalizeUniversitasStudy,
  openShareAccess,
  publicSessionFromRedirect,
  sealShareAccess,
  shareCookieFrom,
  universitasInstanceRequest,
  universitasShortLinkFromHtml,
} from '../../../netlify/functions/lib/mmrad-universitas';
import { verifyInstanceTicket } from '../../../netlify/functions/lib/mmrad-dicom-policy';
import {
  syntheticDicom,
  SYNTHETIC_STUDY_UID,
  SYNTHETIC_SERIES_UID,
  syntheticSopUid,
} from '../fixtures/syntheticDicom';

// Synthetic values with the shapes observed in MMRAD's Universitas viewer (2026-11-02).
const PORTLET =
  'https://ris.mmrad.cl/group/hhangaroa/examenes?p_p_id=2_WAR_ingradteleradexamenportlet_INSTANCE_Ab12' +
  '&p_p_lifecycle=0&p_p_state=exclusive&p_p_mode=view' +
  '&_2_WAR_ingradteleradexamenportlet_INSTANCE_Ab12__spage=%2Fportlet_action%2Fexamen%2Fabrirestudio' +
  '&_2_WAR_ingradteleradexamenportlet_INSTANCE_Ab12_idexamen=123456';
const SHORT_CODE = 'SyntheticShortLinkCode_0123456789abcdef';
const SESSION = '0123456789abcdef01234567';
const COOKIE = `cc_public_share_${SESSION}=synthetic-cookie-value`;
const ACCESS = { session: SESSION, cookie: COOKIE, ttlMs: 9 * 60_000 };
const redirectPage = (codes: string[]) =>
  `<div class="card"><a class="btn" href="https://visorammym.mmrad.cl/s/${codes[0]}">Abrir manualmente</a></div>` +
  codes
    .map(
      code => `<script>window.location.replace("https://visorammym.mmrad.cl/s/${code}")</script>`
    )
    .join('');
const manifest = (overrides: Record<string, unknown> = {}) => ({
  source: 'public',
  wadoRoot: '/api/public/wado',
  serverAE: 'HHANGAROA',
  patient: { id: 'synthetic-internal-id', name: 'PACIENTE PRUEBA', birthDate: '', sex: 'O' },
  study: {
    studyInstanceUid: SYNTHETIC_STUDY_UID,
    accessionNumber: '1',
    date: '20261102',
    description: 'TC SINTETICO',
  },
  series: [
    {
      seriesInstanceUid: SYNTHETIC_SERIES_UID,
      seriesNumber: 2,
      modality: 'CT',
      description: 'Axial sintético',
      instances: [1, 0].map(index => ({
        sopInstanceUid: syntheticSopUid(index),
        instanceNumber: index + 1,
        numberOfFrames: 1,
      })),
    },
  ],
  patientStudies: [],
  publicSession: SESSION,
  ...overrides,
});

describe('MMRAD Universitas viewer', () => {
  beforeEach(() => {
    vi.stubEnv('MMRAD_PASSWORD', 'synthetic-test-secret');
    vi.stubEnv('URL', 'https://app.example.com');
    vi.stubEnv('SITE_NAME', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('recognises only the RIS page that opens one exam in Universitas', () => {
    expect(isUniversitasLink(PORTLET)).toBe(true);
    expect(isUniversitasLink(PORTLET.replace('abrirestudio', 'otraaccion'))).toBe(false);
    expect(isUniversitasLink(PORTLET.replace('idexamen=123456', 'idexamen=abc'))).toBe(false);
    expect(isUniversitasLink(PORTLET.replace('https://ris.mmrad.cl', 'https://evil.example'))).toBe(
      false
    );
    expect(
      isUniversitasLink(
        'https://ris.mmrad.cl/ingrad-ris-informehtml/UtilServlet?a=3&u=1&idexamen=1'
      )
    ).toBe(false);
  });

  it('takes the single short link of the redirect page and the public session behind it', () => {
    expect(universitasShortLinkFromHtml(redirectPage([SHORT_CODE, SHORT_CODE]))).toBe(SHORT_CODE);
    expect(() => universitasShortLinkFromHtml('<p>Sin enlace</p>')).toThrow();
    expect(() =>
      universitasShortLinkFromHtml(redirectPage([SHORT_CODE, `${SHORT_CODE}_other`]))
    ).toThrow();
    expect(publicSessionFromRedirect(`http://visorammym.mmrad.cl/?public=${SESSION}`)).toBe(
      SESSION
    );
    expect(() => publicSessionFromRedirect(`https://evil.example/?public=${SESSION}`)).toThrow();
    expect(() => publicSessionFromRedirect('https://visorammym.mmrad.cl/?public=../x')).toThrow();
    expect(() => publicSessionFromRedirect(null)).toThrow();
  });

  it('keeps only the share cookie that names this session', () => {
    expect(
      shareCookieFrom([`${COOKIE}; Max-Age=567; Path=/; HttpOnly`, 'other=1'], SESSION)
    ).toEqual({ cookie: COOKIE, ttlMs: 537_000 });
    expect(() =>
      shareCookieFrom(['cc_public_share_ffffffffffffffffffffffff=x; HttpOnly'], SESSION)
    ).toThrow();
    expect(() => shareCookieFrom([], SESSION)).toThrow();
  });

  it('seals the share session and cookie so the browser only carries ciphertext', () => {
    const sealed = sealShareAccess(ACCESS);
    expect(sealed).not.toContain(SESSION);
    expect(sealed).not.toContain('synthetic-cookie-value');
    expect(openShareAccess(sealed)).toEqual({ session: SESSION, cookie: COOKIE });
    const tampered = `${sealed.slice(0, -2)}${sealed.endsWith('A') ? 'B' : 'A'}A`;
    expect(() => openShareAccess(tampered)).toThrow();
  });

  it('turns the manifest into signed instances, ordered, keeping only the requested document', () => {
    const study = normalizeUniversitasStudy(manifest(), ACCESS, '11.111.111-1', 'synthetic-user');

    expect(study).toMatchObject({
      uid: SYNTHETIC_STUDY_UID,
      patientId: '111111111',
      date: '20261102',
    });
    expect(study.series[0]).toMatchObject({
      uid: SYNTHETIC_SERIES_UID,
      modality: 'CT',
      description: 'Axial sintético',
    });
    expect(study.series[0].instances.map(instance => instance.number)).toEqual([1, 2]);
    const ticket = verifyInstanceTicket(study.series[0].instances[0].ticket, 'synthetic-user');
    expect(ticket).toMatchObject({
      viewer: 'universitas',
      server: 'HHANGAROA',
      sop: syntheticSopUid(0),
    });
    expect(JSON.stringify(study)).not.toContain(SESSION);
    expect(JSON.stringify(study)).not.toContain('synthetic-cookie-value');
    expect(() => verifyInstanceTicket(study.series[0].instances[0].ticket, 'other-user')).toThrow();
  });

  it.each([
    ['another source', { source: 'bridge' }],
    ['another WADO root', { wadoRoot: 'http://10.0.0.1:1000/wado' }],
    ['an unsafe AE title', { serverAE: '../x' }],
    ['a study without UID', { study: { studyInstanceUid: 'abc' } }],
    [
      'a duplicated instance',
      {
        series: [
          {
            seriesInstanceUid: SYNTHETIC_SERIES_UID,
            instances: [
              { sopInstanceUid: syntheticSopUid(0) },
              { sopInstanceUid: syntheticSopUid(0) },
            ],
          },
        ],
      },
    ],
  ])('refuses a manifest with %s', (_case, overrides) => {
    expect(() =>
      normalizeUniversitasStudy(manifest(overrides), ACCESS, '11.111.111-1', 'synthetic-user')
    ).toThrow();
  });

  it('builds the original request on the viewer host only, with its session and cookie', () => {
    const request = universitasInstanceRequest({
      server: 'HHANGAROA',
      study: SYNTHETIC_STUDY_UID,
      series: SYNTHETIC_SERIES_UID,
      sop: syntheticSopUid(0),
      session: sealShareAccess(ACCESS),
    });
    const url = new URL(request.url);
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://visorammym.mmrad.cl/api/public/wado/HHANGAROA'
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      requestType: 'WADO',
      studyUID: SYNTHETIC_STUDY_UID,
      seriesUID: SYNTHETIC_SERIES_UID,
      objectUID: syntheticSopUid(0),
      contentType: 'application/dicom',
      shareSession: SESSION,
    });
    expect(request.cookie).toBe(COOKIE);
  });

  it('opens a Universitas study end to end through the protected function', async () => {
    const authorize = vi
      .fn()
      .mockResolvedValue({ token: { sub: 'synthetic-user' }, role: 'doctor_urgency' });
    const loadUniversitasManifest = vi
      .fn()
      .mockResolvedValue({ access: ACCESS, manifest: manifest() });
    const loadVendorStudyMetadata = vi.fn();
    const handler = createMMRADDicomHandler({
      authorizeRoleRequest: authorize,
      getFirebaseServer: vi.fn().mockReturnValue({ db: {} }),
      loadVendorStudyMetadata,
      loadUniversitasManifest,
    });
    const event = (body: unknown) => ({
      httpMethod: 'POST',
      headers: { origin: 'https://app.example.com', authorization: 'Bearer synthetic-token' },
      body: JSON.stringify(body),
    });

    const metadata = await handler(
      event({ action: 'metadata', link: PORTLET, patientId: '11.111.111-1' })
    );
    expect(metadata.statusCode).toBe(200);
    expect(loadVendorStudyMetadata).not.toHaveBeenCalled();
    const study = JSON.parse(metadata.body);

    const fetchMock = vi.fn().mockResolvedValue(new Response(syntheticDicom(0)));
    vi.stubGlobal('fetch', fetchMock);
    const instance = await handler(
      event({ action: 'instance', ticket: study.series[0].instances[0].ticket })
    );

    expect(instance.statusCode).toBe(200);
    const [requested, options] = fetchMock.mock.calls[0];
    expect(new URL(requested).host).toBe('visorammym.mmrad.cl');
    expect(new URL(requested).searchParams.get('shareSession')).toBe(SESSION);
    expect(options.headers.Cookie).toBe(COOKIE);
  });
});
