/** Synthetic Eloísa indexes, PDFs and HHR tab for the audit download runtime tests. */
import { vi } from 'vitest';
import { unzipSync } from 'fflate';

import '../../../../extension/message-contract.js';
import '../../../../extension/zip-store-writer.js';
import '../../../../extension/audit-documents-runtime.js';

export type Result = Record<string, unknown> & {
  ok?: boolean;
  error?: string;
  cancelled?: boolean;
  filename?: string;
  documentCount?: number;
  failedCount?: number;
  summary?: Array<Record<string, unknown>>;
};

export interface AuditRuntime {
  handleRequest: (request: Record<string, unknown>) => Promise<Result>;
  cancel: (requestId: string) => { ok: boolean };
  cancelAll: () => { ok: boolean };
}

export const globals = globalThis as typeof globalThis & {
  HhrZipStoreWriter: {
    build: (entries: Array<{ name: string; data: Uint8Array }>, stamp: object) => Uint8Array;
    crc32: (bytes: Uint8Array) => number;
  };
  HhrRayenMessageContract: { types: Record<string, string> };
  HhrAuditDocumentsRuntime: {
    PROGRESS_MESSAGE_TYPE: string;
    MAX_DOCUMENTS: number;
    create: (dependencies: Record<string, unknown>) => AuditRuntime;
  };
};

export const API = 'https://ficha.example.test';
// 2026-11-02 21:10 UTC is 16:10 in Rapa Nui (summer time, UTC-5).
export const NOW = Date.parse('2026-11-02T21:10:00Z');

export interface SyntheticRow {
  encounterId: number;
  patientIdentifier?: string;
  patientIdentifierTypeId?: number;
  deleted?: boolean;
  patientName: string;
  startPeriod: string;
  endPeriod: string | null;
  facilityId?: number;
}

export const row = (overrides: SyntheticRow) => ({ facilityId: 7, deleted: false, ...overrides });

export const PATIENT_A = '11111111-1';
export const PATIENT_B = '12345678-5';

export const discharged = row({
  encounterId: 501,
  patientIdentifier: '111111111',
  patientName: 'Paciente Prueba Uno',
  startPeriod: '2026-07-13T10:00:00.00-04:00',
  endPeriod: '2026-07-17T12:00:00.0-04:00',
});
export const ongoing = row({
  encounterId: 502,
  patientIdentifier: '111111111',
  patientName: 'Paciente Prueba Uno',
  startPeriod: '2026-10-29T09:00:00.00-03:00',
  endPeriod: null,
});

export interface Setup {
  history?: Record<string, unknown[] | number>;
  pharmacological?: Record<string, unknown[] | number>;
  pdfStatus?: (url: URL) => { fatal?: boolean; error?: string } | null;
  pdfBytes?: number;
  now?: number;
  tabReply?: (message: ChunkMessage) => unknown;
}

export interface ChunkMessage {
  type: string;
  requestId: string;
  index: number;
  total: number;
  filename: string;
  base64: string;
}

export const HHR_TAB = {
  tab: { id: 42, url: 'https://testinghhr.netlify.app/census' },
  frameId: 0,
  documentId: 'synthetic-document',
};

export const makeRuntime = (setup: Setup = {}) => {
  const indexes = {
    getEncounterHistoryReport: setup.history ?? { '111111111': [discharged] },
    getPharmacologicalCareReport: setup.pharmacological ?? { '111111111': [ongoing, discharged] },
  };
  const fetchWithTimeout = vi.fn(async (rawUrl: string) => {
    const url = new URL(rawUrl);
    const index = url.pathname.split('/').pop() as keyof typeof indexes;
    const answer = indexes[index][url.searchParams.get('prefferedIdentifierCode') ?? ''] ?? [];
    if (typeof answer === 'number') return { ok: false, status: answer, json: async () => null };
    return { ok: true, status: 200, json: async () => answer };
  });
  const fetchOfficialPdf = vi.fn(async ({ url }: { url: string }) => {
    const parsed = new URL(url);
    const failure = setup.pdfStatus?.(parsed);
    if (failure) return failure;
    const text = new TextEncoder().encode(`%PDF-1.4 ${parsed.pathname}${parsed.search}`);
    const bytes = new Uint8Array(Math.max(text.length, setup.pdfBytes ?? 0));
    bytes.set(text);
    return { buffer: bytes.buffer };
  });
  const sendTabMessage = vi.fn(async (_tabId: number, message: unknown, _options?: unknown) => {
    const chunk = message as ChunkMessage;
    if (chunk.type !== 'RAYEN_AUDIT_DOCUMENTS_FILE_CHUNK') return undefined;
    return setup.tabReply ? setup.tabReply(chunk) : { ok: true };
  });
  const raw = globals.HhrAuditDocumentsRuntime.create({
    chromeApi: { tabs: { sendMessage: sendTabMessage } },
    bufferToBase64: (buffer: ArrayBuffer) => Buffer.from(buffer).toString('base64'),
    getFetchInfo: async () => ({ info: { apiOrigin: API, token: 'synthetic-token', facId: 7 } }),
    fetchWithTimeout,
    fetchOfficialPdf,
    mapWithConcurrency: async <T, R>(
      items: T[],
      _limit: number,
      worker: (item: T) => Promise<R>
    ) => {
      const results: R[] = [];
      for (const item of items) results.push(await worker(item));
      return results;
    },
    zipWriter: globals.HhrZipStoreWriter,
    now: () => setup.now ?? NOW,
    isHhrTabUrl: (url: string) => url.startsWith('https://testinghhr.netlify.app/'),
  });
  const runtime: AuditRuntime = {
    ...raw,
    handleRequest: request => raw.handleRequest({ sender: HHR_TAB, ...request }),
  };
  const zipChunks = () =>
    sendTabMessage.mock.calls
      .map(call => call[1] as ChunkMessage)
      .filter(message => message.type === 'RAYEN_AUDIT_DOCUMENTS_FILE_CHUNK');
  const archive = () => {
    const chunks = zipChunks();
    if (chunks.length === 0) throw new Error('No ZIP was delivered');
    return unzipSync(
      new Uint8Array(Buffer.concat(chunks.map(chunk => Buffer.from(chunk.base64, 'base64'))))
    );
  };
  return { runtime, fetchWithTimeout, fetchOfficialPdf, sendTabMessage, zipChunks, archive };
};

export const BOTH = ['history', 'pharmacological'];
