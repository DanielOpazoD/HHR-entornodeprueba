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

describe('clinical report runtime direct episodes and history', () => {
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
