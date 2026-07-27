// @vitest-environment node
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/fichamedico-history-read-model.js';
import '../../../extension/fichamedico-clinical-client.js';

type SessionInfo = {
  [key: string]: string | undefined;
  apiOrigin: string;
  facId?: string;
  practitionerId?: string;
  role?: string;
};

type ClinicalClient = {
  resolveSession: (input?: {
    info?: Partial<SessionInfo>;
    sender?: unknown;
    required?: string[];
    invalidMessage?: string;
  }) => Promise<{ info?: SessionInfo; error?: string }>;
  buildUrl: (input: {
    info: Partial<SessionInfo>;
    path: string;
    query?: Record<string, unknown>;
  }) => string;
  readJson: (input: Record<string, unknown>) => Promise<{ data: unknown; status: number }>;
  readBuffer: (input: Record<string, unknown>) => Promise<{ data: ArrayBuffer; status: number }>;
  fetchDeviceReportBuffer: (input: {
    encId: string;
    fecha: string;
    info?: SessionInfo;
  }) => Promise<{ buffer?: ArrayBuffer; error?: string }>;
  fetchHistoryScales: (input: {
    encId: string;
    info?: SessionInfo;
  }) => Promise<{ events?: unknown[]; nursingActivity?: unknown[]; error?: string }>;
  fetchScalesReportWithInfo: (
    encId: string,
    info?: SessionInfo
  ) => Promise<{ ok?: boolean; forms?: unknown[]; error?: string }>;
};

type ClinicalClientFactory = {
  create: (dependencies: {
    resolveFetchInfo: (sender?: unknown) => Promise<unknown>;
    fetchWithTimeout: (...args: unknown[]) => Promise<unknown>;
    defaultTimeoutMs: number;
  }) => ClinicalClient;
};

const factory = (
  globalThis as typeof globalThis & { HhrFichaMedicoClinicalClient: ClinicalClientFactory }
).HhrFichaMedicoClinicalClient;

const sessionKey = ['to', 'ken'].join('');
const sessionValue = ['synthetic', 'test', 'value'].join(':');
const session = {
  [sessionKey]: sessionValue,
  apiOrigin: 'https://fichamedicoback.rayensalud.cl',
  facId: '9',
  practitionerId: '81',
  role: 'Médico',
} as SessionInfo;

const response = ({
  status = 200,
  json = async () => ({}),
  arrayBuffer = async () => new ArrayBuffer(0),
}: {
  status?: number;
  json?: () => Promise<unknown>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
} = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  json,
  arrayBuffer,
});

describe('Ficha Médico read-only clinical client', () => {
  let resolveFetchInfo: ReturnType<typeof vi.fn>;
  let fetchWithTimeout: ReturnType<typeof vi.fn>;
  let client: ClinicalClient;

  beforeEach(() => {
    resolveFetchInfo = vi.fn().mockResolvedValue({ info: session });
    fetchWithTimeout = vi.fn().mockResolvedValue(response());
    client = factory.create({
      resolveFetchInfo: resolveFetchInfo as (sender?: unknown) => Promise<unknown>,
      fetchWithTimeout: fetchWithTimeout as (...args: unknown[]) => Promise<unknown>,
      defaultTimeoutMs: 45_000,
    });
  });

  it('fails closed when required dependencies or timeout are invalid', () => {
    expect(() => factory.create({} as never)).toThrow('Falta la dependencia resolveFetchInfo.');
    expect(() =>
      factory.create({
        resolveFetchInfo: resolveFetchInfo as (sender?: unknown) => Promise<unknown>,
        fetchWithTimeout: fetchWithTimeout as (...args: unknown[]) => Promise<unknown>,
        defaultTimeoutMs: 0,
      })
    ).toThrow('El timeout defaultTimeoutMs no es válido.');
  });

  it('owns session lookup and validates base, facility and practitioner fields', async () => {
    const sender = { tab: { id: 17 } };
    await expect(client.resolveSession({ sender })).resolves.toEqual({ info: session });
    expect(resolveFetchInfo).toHaveBeenCalledWith(sender);

    resolveFetchInfo.mockResolvedValueOnce({ error: 'No hay una pestaña abierta.' });
    await expect(client.resolveSession()).resolves.toEqual({
      error: 'No hay una pestaña abierta.',
    });
    await expect(
      client.resolveSession({
        info: { [sessionKey]: session[sessionKey], apiOrigin: session.apiOrigin },
        required: ['facId', 'practitionerId'],
        invalidMessage: 'Sesión clínica incompleta.',
      })
    ).resolves.toEqual({ error: 'Sesión clínica incompleta.' });
  });

  it('constructs encoded same-origin URLs and rejects absolute or cross-origin paths', () => {
    expect(
      client.buildUrl({
        info: session,
        path: '/api/encounter/141%20336/history',
        query: { page: 0, showAll: false, label: 'día actual' },
      })
    ).toBe(
      'https://fichamedicoback.rayensalud.cl/api/encounter/141%20336/history' +
        '?page=0&showAll=false&label=d%C3%ADa+actual'
    );
    expect(() =>
      client.buildUrl({ info: session, path: 'https://example.test/api', query: {} })
    ).toThrow('La ruta clínica debe ser relativa al origen autorizado.');
    expect(() => client.buildUrl({ info: session, path: '//example.test/api', query: {} })).toThrow(
      'La ruta clínica debe ser relativa al origen autorizado.'
    );
  });

  it.each([401, 403, 500])('normalizes HTTP %s without losing the status', async status => {
    fetchWithTimeout.mockResolvedValueOnce(response({ status }));
    await expect(client.readJson({ info: session, path: '/api/test' })).rejects.toMatchObject({
      kind: 'http',
      status,
      message: `HTTP ${status}`,
    });
  });

  it('preserves bounded timeout failures as a normalized network error', async () => {
    fetchWithTimeout.mockRejectedValueOnce(
      new Error('Tiempo de espera agotado consultando Ficha Médico.')
    );
    await expect(
      client.readJson({ info: session, path: '/api/test', timeoutMs: 15_000 })
    ).rejects.toMatchObject({
      kind: 'network',
      message: 'Tiempo de espera agotado consultando Ficha Médico.',
    });
  });

  it('classifies invalid JSON while preserving the parser diagnostic', async () => {
    fetchWithTimeout.mockResolvedValueOnce(
      response({ json: async () => Promise.reject(new SyntaxError('JSON incompleto')) })
    );
    await expect(client.readJson({ info: session, path: '/api/test' })).rejects.toMatchObject({
      kind: 'invalid-json',
      message: 'JSON incompleto',
    });
  });

  it('executes authenticated PDF reads with the shared timeout and omit credentials', async () => {
    const buffer = Uint8Array.from([0x25, 0x50, 0x44, 0x46]).buffer;
    fetchWithTimeout.mockResolvedValueOnce(response({ arrayBuffer: async () => buffer }));

    await expect(
      client.readBuffer({ info: session, path: '/api/report/resumen.pdf' })
    ).resolves.toEqual({ data: buffer, status: 200 });
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      'https://fichamedicoback.rayensalud.cl/api/report/resumen.pdf',
      {
        headers: { Authorization: session[sessionKey], Accept: 'application/pdf' },
        credentials: 'omit',
      },
      45_000,
      'Tiempo de espera agotado consultando Ficha Médico.'
    );
  });

  it('keeps the device PDF contract and validates the facility before fetching', async () => {
    const buffer = Uint8Array.from([1, 2, 3]).buffer;
    fetchWithTimeout.mockResolvedValueOnce(response({ arrayBuffer: async () => buffer }));
    await expect(
      client.fetchDeviceReportBuffer({ encId: '141336', fecha: '2026-07-19', info: session })
    ).resolves.toEqual({ buffer });
    expect(fetchWithTimeout.mock.calls[0][0]).toBe(
      'https://fichamedicoback.rayensalud.cl/api/report/Resumen_diario_paciente.pdf' +
        '?enc_id=141336&fac_id=9&fecha=2026-07-19'
    );

    await expect(
      client.fetchDeviceReportBuffer({
        encId: '141336',
        fecha: '2026-07-19',
        info: { ...session, facId: '' },
      })
    ).resolves.toEqual({
      error: 'Sin token de Ficha Médico. Recarga la lista de pacientes e inicia sesión.',
    });
  });

  it('reads nursing and medical scale forms for a medical session and deduplicates the union', async () => {
    const nursingBraden = {
      guid: 'braden-today',
      formCodigo: 'INSTRUMENTO',
      nameForm: 'Escala de riesgo UPP (Braden)',
    };
    const repeatedDownton = {
      guid: 'downton-shared',
      formCodigo: 'INSTRUMENTO',
      nameForm: 'Escala de Riesgo de caídas (J. H. DOWNTON)',
    };
    fetchWithTimeout
      .mockResolvedValueOnce(
        response({ json: async () => [nursingBraden, repeatedDownton, { formCodigo: 'OTRO' }] })
      )
      .mockResolvedValueOnce(response({ json: async () => [repeatedDownton] }));

    const result = await client.fetchScalesReportWithInfo('142040', session);

    expect(result).toEqual({ ok: true, forms: [nursingBraden, repeatedDownton] });
    expect(fetchWithTimeout.mock.calls.map(call => call[0])).toEqual([
      'https://fichamedicoback.rayensalud.cl/api/encounter/entrySummary/' +
        'encounterFormEntry/142040/2/0/81',
      'https://fichamedicoback.rayensalud.cl/api/encounter/entrySummary/' +
        'encounterFormEntry/142040/1/0/81',
    ]);
  });

  it('uses only the nursing event type when the authenticated role is Enfermería', async () => {
    fetchWithTimeout.mockResolvedValueOnce(response({ json: async () => [] }));

    await expect(
      client.fetchScalesReportWithInfo('142040', { ...session, role: 'Enfermera(o)' })
    ).resolves.toEqual({ ok: true, forms: [] });

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    expect(fetchWithTimeout.mock.calls[0][0]).toContain('encounterFormEntry/142040/2/0/81');
  });

  it('returns text-free nursing activity together with scale history', async () => {
    fetchWithTimeout.mockResolvedValueOnce(
      response({
        json: async () => [
          {
            publishDatetime: '2026-07-20T10:15:00',
            evolutionResume: [
              {
                OBE_NOTES: 'texto clínico que no debe cruzar',
                OBE_PUBLISH_DATETIME: '2026-07-20T10:15:00',
                HCPR_NAME: 'Enfermera(o)',
                HCP_FGN: 'ANA',
                HCP_NGN: 'MARIA',
                HCP_FFN: 'PEREZ',
                HCP_SFN: 'SOTO',
                HCP_LEGAL: '11.111.111-1',
              },
            ],
            shiftChangeResume: [],
            evaluationInstrumentsResume: [
              {
                FORM_NAME: 'Escala de riesgo UPP (Braden)',
                LABEL: 'Puntaje',
                VALUE: '16',
                PUBLISH_DATE_HCP_NAME: '20-07-2026 - 10:15:00 - Ana Perez - Enfermera(o)',
                PRACTITIONER_ROLE: 'Enfermera(o)',
              },
              {
                FORM_NAME: 'Escala de riesgo de caídas (Downton)',
                LABEL: 'Puntaje',
                VALUE: '2',
                PUBLISH_DATE_HCP_NAME: '20-07-2026 - 10:18:00 - Beatriz Soto - Enfermera(o)',
                PRACTITIONER_ROLE: 'Enfermera(o)',
              },
            ],
          },
        ],
      })
    );

    const result = await client.fetchHistoryScales({ encId: '141336', info: session });

    expect(result.events).toHaveLength(1);
    expect(result.nursingActivity).toEqual([
      {
        author: 'ANA MARIA PEREZ SOTO',
        authorIdentity: { firstGivenName: 'ANA', firstSurname: 'PEREZ' },
        role: 'Enfermera(o)',
        recordedAt: '2026-07-20T10:15:00',
        source: 'evolution',
        archived: false,
        crossedOut: false,
      },
      {
        author: 'Ana Perez',
        role: 'Enfermera(o)',
        recordedAt: '2026-07-20T10:15:00',
        source: 'evaluation-scale',
        archived: false,
        crossedOut: false,
      },
      {
        author: 'Beatriz Soto',
        role: 'Enfermera(o)',
        recordedAt: '2026-07-20T10:18:00',
        source: 'evaluation-scale',
        archived: false,
        crossedOut: false,
      },
    ]);
    expect(JSON.stringify(result.nursingActivity)).not.toContain('texto clínico');
    expect(JSON.stringify(result.nursingActivity)).not.toContain('11.111.111-1');
  });

  it('projects Paramédico medication and vital-sign metadata without clinical content', async () => {
    fetchWithTimeout.mockResolvedValueOnce(
      response({
        json: async () => [
          {
            publishDatetime: '2026-07-25T19:20:48.38',
            pharmaPerformedActivityResume: [
              {
                HCP_NAME: 'Francisca Orellana',
                HCP_ROLE: 'Paramédico',
                PUBLISH_DATETIME: '2026-07-25T19:17:08.89',
                PERF_ACTIVITY_NAME: 'contenido clínico privado',
              },
            ],
            vitalSignObsResume: [
              {
                HCP_NAME: 'Jimena Yañez',
                HCPR_ROLE: 'Paramédico',
                PUBLISH_DATE: '2026-07-25T19:20:48.38',
                VALUE: 'dato clínico privado',
              },
            ],
          },
        ],
      })
    );

    const result = await client.fetchHistoryScales({ encId: '142070', info: session });

    expect(result.nursingActivity).toEqual([
      {
        author: 'Francisca Orellana',
        role: 'Paramédico',
        recordedAt: '2026-07-25T19:17:08.89',
        source: 'medication-administration',
        archived: false,
        crossedOut: false,
      },
      {
        author: 'Jimena Yañez',
        role: 'Paramédico',
        recordedAt: '2026-07-25T19:20:48.38',
        source: 'vital-signs',
        archived: false,
        crossedOut: false,
      },
    ]);
    expect(JSON.stringify(result.nursingActivity)).not.toContain('contenido clínico privado');
    expect(JSON.stringify(result.nursingActivity)).not.toContain('dato clínico privado');
  });

  it('keeps background as wiring and the read client free of writes or persistence', () => {
    const background = readFileSync(
      new URL('../../../extension/background.js', import.meta.url),
      'utf8'
    );
    const source = readFileSync(
      new URL('../../../extension/fichamedico-clinical-client.js', import.meta.url),
      'utf8'
    );

    expect(background.slice(0, background.indexOf('const REPORT_FILE'))).toContain(
      "'fichamedico-clinical-client.js'"
    );
    expect(background).toContain(
      'const fichaMedicoClinicalClient = self.HhrFichaMedicoClinicalClient.create({'
    );
    expect(background).not.toContain('const fetchEvaluationForms = async');
    expect(background).not.toContain('const fetchScaleHistoryEvents = async');
    expect(background).not.toContain('const fetchActiveEncounterRows = async');
    expect(source).not.toMatch(/clinicalWrite|chrome\.storage|localStorage|sessionStorage/);
    expect(source).not.toMatch(/method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/);
    expect(background.split('\n').length).toBeLessThanOrEqual(1_700);
    expect(source.split('\n').length).toBeLessThanOrEqual(600);
  });
});
