import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const runtimeSource = readFileSync(path.resolve('extension/clinical-report-runtime.js'), 'utf8');
const hospitalizationReportsSource = readFileSync(
  path.resolve('extension/hospitalization-reports-runtime.js'),
  'utf8'
);
const epicrisisDownloadSource = readFileSync(
  path.resolve('extension/epicrisis-download-runtime.js'),
  'utf8'
);
const backgroundSource = readFileSync(path.resolve('extension/background.js'), 'utf8');

type RuntimeDependencies = Record<string, unknown>;

const loadFactory = () => {
  const context = vm.createContext({
    URL,
    ArrayBuffer,
    Uint8Array,
    TextDecoder,
    encodeURIComponent,
  });
  vm.runInContext(hospitalizationReportsSource, context, {
    filename: 'hospitalization-reports-runtime.js',
  });
  vm.runInContext(epicrisisDownloadSource, context, { filename: 'epicrisis-download-runtime.js' });
  vm.runInContext(runtimeSource, context, { filename: 'clinical-report-runtime.js' });
  return (
    context as unknown as {
      HhrClinicalReportRuntime: { create: (dependencies: RuntimeDependencies) => RuntimeApi };
    }
  ).HhrClinicalReportRuntime;
};

type RuntimeApi = {
  fetchOfficialPdf: (request: {
    url: string;
    token: string;
    label: string;
  }) => Promise<{ buffer?: ArrayBuffer; fatal?: boolean; status?: number; error?: string }>;
  openPdfPrintDialog: (request: {
    buffer: ArrayBuffer;
    filename: string;
  }) => Promise<{ ok?: boolean; printTabId?: number; error?: string }>;
  handleNursingMedicalEpicrisisPrintRequest: (request: {
    encId?: string;
    patientRun: string;
    admissionDate?: string;
    censusDate?: string;
    delivery?: string;
    operation?: string;
    documentType?: string;
    sender?: unknown;
  }) => Promise<{
    ok?: boolean;
    downloadId?: number;
    encId?: string;
    episodes?: Array<{ encId: string; startDate: string; endDate: string; active: boolean }>;
    opened?: boolean;
    error?: string;
  }>;
};

const createDependencies = (overrides: RuntimeDependencies = {}) => ({
  chrome: {
    downloads: { download: vi.fn(async () => 71) },
    storage: { session: { set: vi.fn(async () => undefined) } },
    tabs: { create: vi.fn(async () => ({ id: 81 })) },
    runtime: { getURL: vi.fn((value: string) => `chrome-extension://hhr/${value}`) },
  },
  crypto: { randomUUID: vi.fn(() => 'report-job-id') },
  TextDecoder,
  fetchWithTimeout: vi.fn(),
  getClinicalReportContext: vi.fn(),
  getFichaFetchInfo: vi.fn(),
  mapWithConcurrency: vi.fn(),
  bufferToBase64: vi.fn(() => 'UERG'),
  base64ToArrayBuffer: vi.fn(),
  extensionRuntime: { ensurePdf: vi.fn() },
  pdfPrint: { preparePdfForBrowserPrint: vi.fn(async (buffer: ArrayBuffer) => buffer) },
  prescriptionPrint: {
    buildPrescriptionReportUrl: vi.fn(),
    buildIndicationsReportUrl: vi.fn(),
    buildRegimenReportUrl: vi.fn(),
    buildClinicalReportUrl: vi.fn(),
    buildPrescriptionFilename: vi.fn(),
    extractOfficialPrescriptionContent: vi.fn(),
  },
  prescriptionPdf: { generateProfessionalPrescriptionPdf: vi.fn() },
  epicrisisPdf: {},
  pdfLib: {},
  now: vi.fn(() => 123_456),
  ...overrides,
});

describe('clinical report runtime owner', () => {
  it('is registered before background orchestration and fails closed when absent', () => {
    const startup = backgroundSource.slice(0, backgroundSource.indexOf('const REPORT_FILE'));

    expect(startup).toContain("'clinical-report-runtime.js'");
    expect(startup).toContain("'hospitalization-reports-runtime.js'");
    expect(startup).toContain('No se pudo cargar el runtime de informes clínicos.');
    expect(backgroundSource).toContain('self.HhrClinicalReportRuntime.create({');
    expect(backgroundSource).not.toContain('const fetchOfficialPdf = async');
    expect(backgroundSource).not.toContain('const createCompletePrescriptionPdf = async');
    expect(backgroundSource).not.toMatch(/\nconst resolveDischargedEncounterIdByRun\s*=/);
    expect(runtimeSource).toContain('const resolveDischargedEncounterIdByRun');
    expect(runtimeSource).toContain("url.searchParams.set('filterType', '2')");
    expect(runtimeSource).toContain('contextRun !== normalizedPatientRun');
    expect(runtimeSource).toContain('{ expectedPatientRun: normalizedPatientRun }');
    expect(runtimeSource).toContain('getFichaFetchInfo(sender)');
    expect(runtimeSource).toContain('&& !rowRun(row)');
    expect(runtimeSource).not.toContain('.slice(0, 60)');
  });

  it('rejects incomplete dependency injection', () => {
    expect(() => loadFactory().create({})).toThrow(
      'No se pudo inicializar el runtime de informes clínicos.'
    );
  });

  it('preserves official PDF authentication and validates the response signature', async () => {
    const fetchWithTimeout = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(new TextEncoder().encode('%PDF-valid'), {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        })
      )
      .mockResolvedValueOnce(new Response(new TextEncoder().encode('forbidden'), { status: 403 }))
      .mockResolvedValueOnce(new Response(new TextEncoder().encode('not-a-pdf'), { status: 200 }));
    const runtime = loadFactory().create(createDependencies({ fetchWithTimeout }));

    const valid = await runtime.fetchOfficialPdf({
      url: 'https://fichamedicoback.rayensalud.cl/api/report/test.pdf',
      token: 'Bearer session-token',
      label: 'el informe',
    });
    const forbidden = await runtime.fetchOfficialPdf({
      url: 'https://fichamedicoback.rayensalud.cl/api/report/test.pdf',
      token: 'Bearer session-token',
      label: 'el informe',
    });
    const invalid = await runtime.fetchOfficialPdf({
      url: 'https://fichamedicoback.rayensalud.cl/api/report/test.pdf',
      token: 'Bearer session-token',
      label: 'el informe',
    });

    expect(Array.from(new Uint8Array(valid.buffer as ArrayBuffer).slice(0, 4))).toEqual(
      Array.from(new TextEncoder().encode('%PDF'))
    );
    expect(fetchWithTimeout).toHaveBeenNthCalledWith(1, expect.any(String), {
      headers: { Authorization: 'Bearer session-token', Accept: 'application/pdf' },
      credentials: 'omit',
    });
    expect(forbidden).toEqual({
      fatal: true,
      status: 403,
      error: 'Eloísa no autorizó el informe para la sesión actual.',
    });
    expect(invalid).toEqual({ status: 200, error: 'La respuesta no es un PDF válido.' });
  });

  it('keeps the print job filename, storage envelope and active browser tab contract', async () => {
    const storageSet = vi.fn(async () => undefined);
    const createTab = vi.fn(async () => ({ id: 81 }));
    const ensurePdf = vi.fn();
    const encodedSource = new TextEncoder().encode('%PDF-source');
    const source = new ArrayBuffer(encodedSource.byteLength);
    new Uint8Array(source).set(encodedSource);
    const dependencies = createDependencies({
      chrome: {
        downloads: { download: vi.fn(async () => 71) },
        storage: { session: { set: storageSet } },
        tabs: { create: createTab },
        runtime: { getURL: (value: string) => `chrome-extension://hhr/${value}` },
      },
      extensionRuntime: { ensurePdf },
    });
    const runtime = loadFactory().create(dependencies);

    await expect(
      runtime.openPdfPrintDialog({
        buffer: source,
        filename: 'Epicrisis_medica_corregida_123.pdf',
      })
    ).resolves.toEqual({ ok: true, printTabId: 81 });

    expect(ensurePdf).toHaveBeenCalledOnce();
    expect(storageSet).toHaveBeenCalledWith({
      'hhr-pdf-print-report-job-id': {
        base64: 'UERG',
        filename: 'Epicrisis_medica_corregida_123.pdf',
        createdAt: 123_456,
      },
    });
    expect(createTab).toHaveBeenCalledWith({
      url: 'chrome-extension://hhr/print-pdf.html?job=report-job-id',
      active: true,
    });
  });

  it('searches the official reports module by normalized RUN and downloads the exact episode', async () => {
    const download = vi.fn(async () => 71);
    const fetchWithTimeout = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              encounterId: 141336,
              patientIdentifier: 'OTRO-IDENTIFICADOR',
              preferredIdentifierCode: '17.752.753-1',
              startPeriod: '2026-07-18T12:00:00.000Z',
              endPeriod: null,
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(new TextEncoder().encode('%PDF-epicrisis'), {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        })
      );
    const runtime = loadFactory().create(
      createDependencies({
        chrome: {
          downloads: { download },
          storage: { session: { set: vi.fn(async () => undefined) } },
          tabs: { create: vi.fn(async () => ({ id: 81 })) },
          runtime: { getURL: (value: string) => `chrome-extension://hhr/${value}` },
        },
        fetchWithTimeout,
        getFichaFetchInfo: vi.fn(async () => ({
          info: {
            apiOrigin: 'https://fichamedicoback.rayensalud.cl',
            token: 'testing',
            facId: '2',
          },
        })),
      })
    );

    await expect(
      runtime.handleNursingMedicalEpicrisisPrintRequest({
        encId: '141336',
        patientRun: '17.752.753-1',
        delivery: 'download',
      })
    ).resolves.toEqual({ ok: true, downloadId: 71, encId: '141336' });

    const searchUrl = new URL(fetchWithTimeout.mock.calls[0][0]);
    expect(searchUrl.pathname).toBe('/api/inpatientReport/getEncounterHistoryReport');
    expect(searchUrl.searchParams.get('prefferedPeridentId')).toBe('2');
    expect(searchUrl.searchParams.get('prefferedIdentifierCode')).toBe('177527531');
    expect(searchUrl.searchParams.get('dateFrom')).toBe('');
    const reportUrl = new URL(fetchWithTimeout.mock.calls[1][0]);
    expect(reportUrl.pathname).toBe('/api/report/Reporte_Epicrisis.pdf');
    expect([...reportUrl.searchParams.entries()]).toEqual([['enc_id', '141336']]);
    expect(download).toHaveBeenCalledWith({
      url: 'data:application/pdf;base64,UERG',
      filename: 'Epicrisis_medica_141336.pdf',
      saveAs: false,
      conflictAction: 'uniquify',
    });
  });

  it('uses the latest discharged episode no later than the census date for legacy rows', async () => {
    const fetchWithTimeout = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              encounterId: 100,
              patientIdentifier: '29335605K',
              startPeriod: '2026-07-16T18:00:00.000Z',
              endPeriod: '2026-07-17T18:00:00.000Z',
            },
            {
              encounterId: 200,
              patientIdentifier: '29.335.605-K',
              endPeriod: '2026-07-20T18:00:00.000Z',
            },
            {
              encounterId: 150,
              patientIdentifier: '29335605K',
              startPeriod: '2026-07-10T18:00:00.000Z',
              endPeriod: '2026-07-18T18:00:00.000Z',
            },
          ]),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(new TextEncoder().encode('%PDF-epicrisis'), { status: 200 })
      );
    const runtime = loadFactory().create(
      createDependencies({
        fetchWithTimeout,
        getFichaFetchInfo: vi.fn(async () => ({
          info: {
            apiOrigin: 'https://fichamedicoback.rayensalud.cl',
            token: 'testing',
            facId: '2',
          },
        })),
      })
    );

    const result = await runtime.handleNursingMedicalEpicrisisPrintRequest({
      patientRun: '29.335.605-K',
      censusDate: '2026-07-19',
      delivery: 'download',
    });

    expect(result).toMatchObject({ ok: true, encId: '150' });
    expect(new URL(fetchWithTimeout.mock.calls[1][0]).searchParams.get('enc_id')).toBe('150');
  });

  it('fails closed when the requested episode does not belong to the RUN search results', async () => {
    const fetchWithTimeout = vi.fn(
      async () =>
        new Response(JSON.stringify([{ encounterId: 999, patientIdentifier: '17.752.753-1' }]), {
          status: 200,
        })
    );
    const runtime = loadFactory().create(
      createDependencies({
        fetchWithTimeout,
        getFichaFetchInfo: vi.fn(async () => ({
          info: {
            apiOrigin: 'https://fichamedicoback.rayensalud.cl',
            token: 'testing',
            facId: '2',
          },
        })),
      })
    );

    await expect(
      runtime.handleNursingMedicalEpicrisisPrintRequest({
        encId: '141336',
        patientRun: '17.752.753-1',
        delivery: 'download',
      })
    ).resolves.toEqual({
      error: expect.stringContaining('no aparece entre los informes de este RUN'),
    });
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('lists every matching hospitalization using only episode identifiers and dates', async () => {
    const fetchWithTimeout = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              encounterId: 100,
              patientIdentifier: '17.752.753-1',
              startPeriod: '2025-05-01T08:00:00-04:00',
              endPeriod: '2025-05-05T14:00:00-04:00',
              incomeDiagnosis: 'must not cross',
            },
            {
              encounterId: 200,
              patientIdentifier: '177527531',
              startPeriod: '2026-07-18T08:00:00-04:00',
              endPeriod: null,
            },
            {
              encounterId: 300,
              patientIdentifier: '11.111.111-1',
              startPeriod: '2026-07-19T08:00:00-04:00',
            },
          ]),
          { status: 200 }
        )
    );
    const runtime = loadFactory().create(
      createDependencies({
        fetchWithTimeout,
        getFichaFetchInfo: vi.fn(async () => ({
          info: {
            apiOrigin: 'https://fichamedicoback.rayensalud.cl',
            token: 'testing',
            facId: '2',
          },
        })),
      })
    );

    await expect(
      runtime.handleNursingMedicalEpicrisisPrintRequest({
        patientRun: '17.752.753-1',
        delivery: 'download',
        operation: 'list',
      })
    ).resolves.toEqual({
      ok: true,
      episodes: [
        { encId: '200', startDate: '2026-07-18', endDate: '', active: true },
        { encId: '100', startDate: '2025-05-01', endDate: '2025-05-05', active: false },
      ],
    });
  });

  it('lists the synced episode for a newborn without RUN and does not perform a RUN search', async () => {
    const fetchWithTimeout = vi.fn();
    const runtime = loadFactory().create(
      createDependencies({
        fetchWithTimeout,
        getFichaFetchInfo: vi.fn(async () => ({
          info: {
            apiOrigin: 'https://fichamedicoback.rayensalud.cl',
            token: 'testing',
            facId: '2',
          },
        })),
      })
    );

    await expect(
      runtime.handleNursingMedicalEpicrisisPrintRequest({
        encId: '141814',
        patientRun: '',
        admissionDate: '2026-07-20',
        delivery: 'download',
        operation: 'list',
      })
    ).resolves.toEqual({
      ok: true,
      episodes: [{ encId: '141814', startDate: '2026-07-20', endDate: '' }],
    });
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('lists and downloads the exact newborn episode even when a legacy row has no admission date', async () => {
    const fetchWithTimeout = vi.fn(
      async () =>
        new Response(new TextEncoder().encode('%PDF-epicrisis'), {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        })
    );
    const runtime = loadFactory().create(
      createDependencies({
        fetchWithTimeout,
        getFichaFetchInfo: vi.fn(async () => ({
          info: {
            apiOrigin: 'https://fichamedicoback.rayensalud.cl',
            token: 'testing',
            facId: '2',
          },
        })),
      })
    );

    await expect(
      runtime.handleNursingMedicalEpicrisisPrintRequest({
        encId: '141814',
        patientRun: '',
        delivery: 'download',
        operation: 'list',
      })
    ).resolves.toEqual({
      ok: true,
      episodes: [{ encId: '141814', startDate: '', endDate: '' }],
    });

    await expect(
      runtime.handleNursingMedicalEpicrisisPrintRequest({
        encId: '141814',
        patientRun: '',
        delivery: 'download',
        operation: 'download',
        documentType: 'epicrisis',
      })
    ).resolves.toMatchObject({ ok: true, encId: '141814' });
  });

  it('downloads the exact newborn episode without requiring a RUN', async () => {
    const fetchWithTimeout = vi.fn(
      async (_url: string) =>
        new Response(new TextEncoder().encode('%PDF-epicrisis'), {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        })
    );
    const runtime = loadFactory().create(
      createDependencies({
        fetchWithTimeout,
        getFichaFetchInfo: vi.fn(async () => ({
          info: {
            apiOrigin: 'https://fichamedicoback.rayensalud.cl',
            token: 'testing',
            facId: '2',
          },
        })),
      })
    );

    await expect(
      runtime.handleNursingMedicalEpicrisisPrintRequest({
        encId: '141814',
        patientRun: '',
        admissionDate: '2026-07-20',
        delivery: 'download',
        operation: 'download',
        documentType: 'epicrisis',
      })
    ).resolves.toMatchObject({ ok: true, encId: '141814' });
    const reportUrl = new URL(fetchWithTimeout.mock.calls[0][0]);
    expect(reportUrl.pathname).toBe('/api/report/Reporte_Epicrisis.pdf');
    expect(reportUrl.searchParams.get('enc_id')).toBe('141814');
  });

  it('opens the complete history for a newborn episode without requiring a RUN', async () => {
    const createTab = vi.fn(async (_options: { url: string }) => ({ id: 81 }));
    const fetchWithTimeout = vi.fn();
    const runtime = loadFactory().create(
      createDependencies({
        fetchWithTimeout,
        chrome: {
          downloads: { download: vi.fn(async () => 71) },
          storage: { session: { set: vi.fn(async () => undefined) } },
          tabs: { create: createTab },
          runtime: { getURL: (value: string) => `chrome-extension://hhr/${value}` },
        },
        getFichaFetchInfo: vi.fn(async () => ({
          info: {
            apiOrigin: 'https://fichamedicoback.rayensalud.cl',
            token: 'testing',
            facId: '2',
          },
        })),
      })
    );

    await expect(
      runtime.handleNursingMedicalEpicrisisPrintRequest({
        encId: '141814',
        patientRun: '',
        admissionDate: '2026-07-20',
        delivery: 'download',
        operation: 'download',
        documentType: 'history',
      })
    ).resolves.toMatchObject({ ok: true, opened: true, encId: '141814' });
    const openedUrl = new URL(createTab.mock.calls[0][0].url);
    expect(openedUrl.searchParams.get('report')).toBe('GetHospitalizedEncounterHistory');
    expect(JSON.parse(openedUrl.searchParams.get('params') || '{}')).toMatchObject({
      enc_id: '141814',
      start_date: '2026-07-20',
    });
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('opens the official complete-history report for the selected episode', async () => {
    const createTab = vi.fn(async (_options: { url: string }) => ({ id: 81, windowId: 7 }));
    const focusWindow = vi.fn(async () => undefined);
    const fetchWithTimeout = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            {
              encounterId: 141336,
              patientIdentifier: '17.752.753-1',
              startPeriod: '2026-07-18T08:00:00-04:00',
              endPeriod: '2026-07-19T10:00:00-04:00',
            },
          ]),
          { status: 200 }
        )
    );
    const runtime = loadFactory().create(
      createDependencies({
        fetchWithTimeout,
        chrome: {
          downloads: { download: vi.fn(async () => 71) },
          storage: { session: { set: vi.fn(async () => undefined) } },
          tabs: { create: createTab },
          windows: { update: focusWindow },
          runtime: { getURL: (value: string) => `chrome-extension://hhr/${value}` },
        },
        getFichaFetchInfo: vi.fn(async () => ({
          info: {
            apiOrigin: 'https://fichamedicoback.rayensalud.cl',
            token: 'testing',
            facId: '2',
          },
        })),
      })
    );

    await expect(
      runtime.handleNursingMedicalEpicrisisPrintRequest({
        encId: '141336',
        patientRun: '17.752.753-1',
        delivery: 'download',
        operation: 'download',
        documentType: 'history',
      })
    ).resolves.toMatchObject({ ok: true, opened: true, encId: '141336' });
    const openedUrl = new URL(createTab.mock.calls[0][0].url);
    expect(openedUrl.searchParams.get('report')).toBe('GetHospitalizedEncounterHistory');
    expect(JSON.parse(openedUrl.searchParams.get('params') || '{}')).toEqual({
      enc_id: '141336',
      start_date: '2026-07-18T08:00:00-04:00',
      end_date: '2026-07-19T10:00:00-04:00',
    });
    expect(focusWindow).toHaveBeenCalledWith(7, { focused: true });
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('fails safely when complete-history browser dependencies are unavailable', async () => {
    const context = vm.createContext({ URL, Date });
    vm.runInContext(hospitalizationReportsSource, context, {
      filename: 'hospitalization-reports-runtime.js',
    });
    const reports = (
      context as unknown as {
        HhrHospitalizationReportsRuntime: {
          openHistoryReport: (request: Record<string, unknown>) => Promise<{ error?: string }>;
        };
      }
    ).HhrHospitalizationReportsRuntime;

    await expect(
      reports.openHistoryReport({
        resolved: {
          encId: '141336',
          row: { startPeriod: '2026-07-18T08:00:00-04:00', endPeriod: null },
        },
      })
    ).resolves.toEqual({
      error: 'No se pudo acceder al navegador para abrir la ficha clínica completa.',
    });
  });
});
