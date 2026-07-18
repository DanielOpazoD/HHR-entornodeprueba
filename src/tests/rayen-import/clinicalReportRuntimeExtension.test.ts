import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const runtimeSource = readFileSync(path.resolve('extension/clinical-report-runtime.js'), 'utf8');
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
});
