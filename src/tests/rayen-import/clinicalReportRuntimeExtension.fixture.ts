/** Shared isolated runtime factory with synthetic-only dependencies. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { vi } from 'vitest';

export const runtimeSource = readFileSync(
  path.resolve('extension/clinical-report-runtime.js'),
  'utf8'
);
const hospitalizationReportSearchSource = readFileSync(
  path.resolve('extension/hospitalization-report-search-runtime.js'),
  'utf8'
);
const hospitalizationReportsSource = readFileSync(
  path.resolve('extension/hospitalization-reports-runtime.js'),
  'utf8'
);
const epicrisisDownloadSource = readFileSync(
  path.resolve('extension/epicrisis-download-runtime.js'),
  'utf8'
);
export const backgroundSource = readFileSync(path.resolve('extension/background.js'), 'utf8');

type RuntimeDependencies = Record<string, unknown>;

export const loadFactory = () => {
  const context = vm.createContext({
    URL,
    ArrayBuffer,
    Uint8Array,
    TextDecoder,
    encodeURIComponent,
  });
  vm.runInContext(hospitalizationReportSearchSource, context, {
    filename: 'hospitalization-report-search-runtime.js',
  });
  vm.runInContext(hospitalizationReportsSource, context, {
    filename: 'hospitalization-reports-runtime.js',
  });
  vm.runInContext(
    readFileSync(path.resolve('extension/epicrisis-pdf-download.js'), 'utf8'),
    context,
    { filename: 'epicrisis-pdf-download.js' }
  );
  vm.runInContext(epicrisisDownloadSource, context, { filename: 'epicrisis-download-runtime.js' });
  vm.runInContext(runtimeSource, context, { filename: 'clinical-report-runtime.js' });
  return (
    context as unknown as {
      HhrClinicalReportRuntime: { create: (dependencies: RuntimeDependencies) => RuntimeApi };
    }
  ).HhrClinicalReportRuntime;
};

type RuntimeApi = {
  downloadPdfBuffer: (request: {
    buffer: ArrayBuffer;
    filename: string;
    saveAs?: boolean;
  }) => Promise<{ ok?: boolean; downloadId?: number; error?: string }>;
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

export const createDependencies = (overrides: RuntimeDependencies = {}) => ({
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
