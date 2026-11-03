import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  samePersonName,
  searchMistypedCheckDigitExams,
} from '../../../netlify/functions/lib/mmrad-check-digit-search';
import { isSameRutWithOtherVerifier, otherRutVerifierVariants } from '@/utils/rutUtils';
import { suppressProcessStdout, type RestorableSpy } from '@/tests/utils/consoleTestUtils';

// Synthetic patient: 11.111.111-1 is a valid RUT; any other check digit is a mistyped one.
const RUT = '11111111-1';
const NAME = 'Ana Prueba Uno';

describe('exams MMRAD registered with a mistyped check digit', () => {
  it('pairs only the same RUT number with another check digit, never a passport', () => {
    expect(isSameRutWithOtherVerifier(RUT, '11.111.111-7')).toBe(true);
    expect(isSameRutWithOtherVerifier(RUT, '11111111k')).toBe(true);
    expect(isSameRutWithOtherVerifier(RUT, '11.111.111-1')).toBe(false);
    expect(isSameRutWithOtherVerifier(RUT, '11111112-7')).toBe(false);
    expect(isSameRutWithOtherVerifier(RUT, 'AB1111111')).toBe(false);
    expect(isSameRutWithOtherVerifier('11111111-2', '11111111-7')).toBe(false);
    expect(otherRutVerifierVariants('11.111.111-1')).toEqual(
      ['0', '2', '3', '4', '5', '6', '7', '8', '9', 'K'].map(dv => `11111111-${dv}`)
    );
    expect(otherRutVerifierVariants('11111111-2')).toEqual([]);
  });

  it('matches a name only when every word of the shorter one is in the other', () => {
    expect(samePersonName(NAME, 'PRUEBA UNO ANA')).toBe(true);
    expect(samePersonName(NAME, 'ANA PRUEBA')).toBe(true);
    expect(samePersonName('Ána Prueba Uno', 'ANA PRUEBA UNO')).toBe(true);
    // A relative shares surnames, not the given name.
    expect(samePersonName(NAME, 'JUAN PRUEBA UNO')).toBe(false);
    expect(samePersonName(NAME, 'ANA')).toBe(false);
    // Particles never count as a name: «DE LA CRUZ» is one word for this rule.
    expect(samePersonName('María de la Cruz Pérez', 'DE LA CRUZ')).toBe(false);
    expect(samePersonName('María de la Cruz Pérez', 'MARIA DE LA CRUZ')).toBe(true);
    expect(samePersonName(NAME, '')).toBe(false);
  });

  it('keeps matching rows once, marks the registration, and reports a failed variant', async () => {
    const rows: Record<
      string,
      Array<{ exam: { id: string }; patientId: string; patientName: string }>
    > = {
      '11111111-7': [
        { exam: { id: 'ct' }, patientId: '11.111.111-7', patientName: 'PRUEBA UNO ANA' },
        { exam: { id: 'relative' }, patientId: '11111111-7', patientName: 'JUAN PRUEBA UNO' },
      ],
      // The RIS can list the same record under two searched variants.
      '11111111-0': [
        { exam: { id: 'ct' }, patientId: '11.111.111-7', patientName: 'PRUEBA UNO ANA' },
        { exam: { id: 'passport' }, patientId: 'AB1111111', patientName: NAME },
      ],
    };
    const search = vi.fn(async (id: string) => {
      if (id === '11111111-5') throw new TypeError('synthetic network failure');
      return rows[id] ?? [];
    });

    const result = await searchMistypedCheckDigitExams({
      rut: RUT,
      patientName: NAME,
      search,
      key: exam => exam.id,
    });

    expect(search).toHaveBeenCalledTimes(10);
    expect(search).not.toHaveBeenCalledWith(RUT);
    expect(result).toEqual({
      exams: [
        {
          id: 'ct',
          registered_patient_id: '11.111.111-7',
          registered_patient_name: 'PRUEBA UNO ANA',
        },
      ],
      complete: false,
    });
  });

  it('searches one check digit at a time, because the RIS session drops concurrent results', async () => {
    let running = 0;
    let peak = 0;
    const search = vi.fn(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise(resolve => setTimeout(resolve, 1));
      running--;
      return [];
    });
    await searchMistypedCheckDigitExams({ rut: RUT, patientName: NAME, search, key: String });
    expect(search).toHaveBeenCalledTimes(10);
    expect(peak).toBe(1);
  });

  it('does not search other check digits without the census name', async () => {
    const search = vi.fn(async () => []);
    expect(
      await searchMistypedCheckDigitExams({ rut: RUT, patientName: ' ', search, key: String })
    ).toEqual({ exams: [], complete: true });
    expect(search).not.toHaveBeenCalled();
  });
});

describe('mmrad-search with mistyped check digits', () => {
  const fetchMock = vi.fn();
  const originalEnv = { ...process.env };
  let stdout: RestorableSpy;
  const searchActionUrl = 'https://ris.mmrad.cl/examenportlet_WAR_portlet/search?p_l_id=456';
  const page = (html: string, status = 200, location?: string) => ({
    status,
    headers: new Headers(location ? { location } : {}),
    text: vi.fn().mockResolvedValue(html),
  });
  const row = (id: string, name: string, exam: string, mod: string, idexamen: number) =>
    `<tr><td>0</td><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>02/11/2026</td>` +
    `<td>02/11/2026 0${idexamen}:00</td><td>${id}</td><td>${name}</td><td>${exam}</td>` +
    `<td>${mod}</td><td>12</td><td>Validado</td><td>Acciones</td>` +
    `<td><a href="javascript:window.open('https://ris.mmrad.cl/group/hhangaroa/examenes?p_p_id=2_WAR_ingradteleradexamenportlet_INSTANCE_Ab12&amp;_2_WAR_ingradteleradexamenportlet_INSTANCE_Ab12__spage=%2Fportlet_action%2Fexamen%2Fabrirestudio&amp;_2_WAR_ingradteleradexamenportlet_INSTANCE_Ab12_idexamen=${idexamen}');void(0);">Visualizador Universitas</a></td></tr>`;
  const searches: string[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    searches.length = 0;
    const { forgetMMRADSession } = await import('../../../netlify/functions/lib/mmrad-session');
    forgetMMRADSession();
    process.env = {
      ...originalEnv,
      URL: 'https://app.example.com',
      MMRAD_USERNAME: 'synthetic-user',
      MMRAD_PASSWORD: 'synthetic-pass',
    };
    stdout = suppressProcessStdout();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/web/guest/home'))
        return page(
          '<form action="https://ris.mmrad.cl/c/portal/login%2Flogin;jsessionid=abc?p_l_id=1" method="post"><input name="_58_login"/></form>'
        );
      if (url.includes('/c/portal/login')) return page('', 302, '/c/portal/redirect');
      if (url.includes('/c/portal/redirect')) return page('', 302, '/group/hhangaroa');
      if (url.endsWith('/group/hhangaroa'))
        return page(
          `<form action="${searchActionUrl}" method="post"><input name="idpaciente" /></form>`
        );
      if (url === searchActionUrl) {
        const id = new URLSearchParams(String(init.body)).get('idpaciente') ?? '';
        searches.push(id);
        if (id === '11111111-5') throw new TypeError('synthetic network failure');
        const rows =
          id === RUT
            ? row('11111111-1', 'ANA PRUEBA UNO', 'Examen CHEST', 'DX', 1)
            : id === '11111111-7'
              ? row('11111111-7', 'PRUEBA UNO ANA', 'TC TORAX', 'CT', 2) +
                row('11111111-7', 'JUAN PRUEBA UNO', 'TC CEREBRO', 'CT', 3)
              : '';
        return page(`<form><input name="idpaciente" /></form><table>${rows}</table>`);
      }
      throw new Error(`unexpected request ${url}`);
    });
  });
  afterEach(() => {
    stdout.mockRestore();
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  const search = async (query: string) => {
    const { createMMRADSearchHandler } = await import('../../../netlify/functions/mmrad-search');
    const handler = createMMRADSearchHandler({
      getFirebaseServer: vi.fn().mockReturnValue({ db: {} }),
      authorizeRoleRequest: vi.fn().mockResolvedValue({ role: 'doctor_urgency' }),
      extractBearerToken: vi.fn().mockReturnValue('synthetic-token'),
    } as never);
    const response = await handler({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer synthetic-token' },
      body: null,
      rawQuery: query,
    });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body);
  };

  it('adds the exams of the same number and name, marked, after the exact ones', async () => {
    const body = await search(`rut=11.111.111-1&name=${encodeURIComponent(NAME)}`);

    expect(searches[0]).toBe(RUT);
    expect(searches).toHaveLength(11);
    expect(body.check_digit_search).toBe('partial');
    expect(
      body.examenes.map((exam: Record<string, unknown>) => [
        exam.nombre_examen,
        exam.registered_patient_id,
      ])
    ).toEqual([
      ['Examen CHEST', undefined],
      ['TC TORAX', '11111111-7'],
    ]);
  });

  it('never reads a logged-out results page as a patient without exams', async () => {
    const answer = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url === searchActionUrl ? page('<form><input name="_58_login" /></form>') : answer(url, init)
    );
    const { createMMRADSearchHandler } = await import('../../../netlify/functions/mmrad-search');
    const response = await createMMRADSearchHandler({
      getFirebaseServer: vi.fn().mockReturnValue({ db: {} }),
      authorizeRoleRequest: vi.fn().mockResolvedValue({ role: 'doctor_urgency' }),
      extractBearerToken: vi.fn().mockReturnValue('synthetic-token'),
    } as never)({
      httpMethod: 'GET',
      headers: { authorization: 'Bearer synthetic-token' },
      body: null,
      rawQuery: 'rut=11.111.111-1',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('examenes');
  });

  it('keeps the exact search alone when no census name is sent', async () => {
    const body = await search('rut=11.111.111-1');

    expect(searches).toEqual([RUT]);
    expect(body).not.toHaveProperty('check_digit_search');
    expect(body.examenes).toHaveLength(1);
  });
});
