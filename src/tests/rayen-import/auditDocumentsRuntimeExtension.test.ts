// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';

import '../../../extension/message-contract.js';
import '../../../extension/zip-store-writer.js';
import '../../../extension/audit-documents-runtime.js';

type Result = Record<string, unknown> & {
  ok?: boolean;
  error?: string;
  cancelled?: boolean;
  filename?: string;
  documentCount?: number;
  failedCount?: number;
  summary?: Array<Record<string, unknown>>;
};

interface AuditRuntime {
  handleRequest: (request: Record<string, unknown>) => Promise<Result>;
  cancel: (requestId: string) => { ok: boolean };
  cancelAll: () => { ok: boolean };
}

const globals = globalThis as typeof globalThis & {
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

const API = 'https://ficha.example.test';
// 2026-11-02 21:10 UTC is 16:10 in Rapa Nui (summer time, UTC-5).
const NOW = Date.parse('2026-11-02T21:10:00Z');

interface SyntheticRow {
  encounterId: number;
  patientIdentifier: string;
  patientName: string;
  startPeriod: string;
  endPeriod: string | null;
  facilityId?: number;
}

const row = (overrides: SyntheticRow) => ({ facilityId: 7, deleted: false, ...overrides });

const PATIENT_A = '11111111-1';
const PATIENT_B = '12345678-5';

const discharged = row({
  encounterId: 501,
  patientIdentifier: '111111111',
  patientName: 'Paciente Prueba Uno',
  startPeriod: '2026-07-13T10:00:00.00-04:00',
  endPeriod: '2026-07-17T12:00:00.0-04:00',
});
const ongoing = row({
  encounterId: 502,
  patientIdentifier: '111111111',
  patientName: 'Paciente Prueba Uno',
  startPeriod: '2026-10-29T09:00:00.00-03:00',
  endPeriod: null,
});

interface Setup {
  history?: Record<string, unknown[] | number>;
  pharmacological?: Record<string, unknown[] | number>;
  pdfStatus?: (url: URL) => { fatal?: boolean; error?: string } | null;
  pdfBytes?: number;
  tabReply?: (message: ChunkMessage) => unknown;
}

interface ChunkMessage {
  type: string;
  requestId: string;
  index: number;
  total: number;
  filename: string;
  base64: string;
}

const HHR_TAB = {
  tab: { id: 42, url: 'https://testinghhr.netlify.app/census' },
  frameId: 0,
  documentId: 'synthetic-document',
};

const makeRuntime = (setup: Setup = {}) => {
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
    now: () => NOW,
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

const BOTH = ['history', 'pharmacological'];

describe('audit download of official Eloísa reports', () => {
  it('puts both reports of every hospitalization in one ZIP, named by patient, RUT and type', async () => {
    const { runtime, archive, zipChunks, sendTabMessage } = makeRuntime();

    const result = await runtime.handleRequest({
      requestId: 'req-1',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });

    expect(result).toMatchObject({ ok: true, documentCount: 4, failedCount: 0 });
    // Delivered only to the document that asked, never to a page the tab navigated to.
    expect(sendTabMessage.mock.calls.at(-1)?.[2]).toEqual({
      frameId: 0,
      documentId: 'synthetic-document',
    });
    expect(zipChunks()).toEqual([
      expect.objectContaining({
        requestId: 'req-1',
        index: 0,
        total: 1,
        filename: 'Auditoria_Eloisa_2026-11-02_1610.zip',
      }),
    ]);
    // The page only hears counts, never names or RUTs.
    expect(sendTabMessage).toHaveBeenCalledWith(42, {
      type: 'RAYEN_AUDIT_DOCUMENTS_PROGRESS',
      requestId: 'req-1',
      phase: 'downloading',
      done: 4,
      total: 4,
    });
    const files = archive();
    expect(Object.keys(files).sort()).toEqual([
      '00 Resumen.csv',
      'Paciente Prueba Uno - 11111111-1 - Cuidados farmacologicos - ingreso 2026-07-13.pdf',
      'Paciente Prueba Uno - 11111111-1 - Cuidados farmacologicos - ingreso 2026-10-29.pdf',
      'Paciente Prueba Uno - 11111111-1 - Historial hospitalizacion - ingreso 2026-07-13.pdf',
      'Paciente Prueba Uno - 11111111-1 - Historial hospitalizacion - ingreso 2026-10-29.pdf',
    ]);
    // The ongoing hospitalization only appears in the pharmacological index; its history runs to now.
    const ongoingHistory = strFromU8(
      files['Paciente Prueba Uno - 11111111-1 - Historial hospitalizacion - ingreso 2026-10-29.pdf']
    );
    expect(ongoingHistory).toContain('/api/reportServer/GetHospitalizedEncounterHistory');
    expect(new URLSearchParams(ongoingHistory.split('?')[1]).get('end_date')).toBe(
      '2026-11-02T21:10:00.000Z'
    );
    const pharmacological = strFromU8(
      files['Paciente Prueba Uno - 11111111-1 - Cuidados farmacologicos - ingreso 2026-07-13.pdf']
    );
    expect(pharmacological).toContain('GetPharmacologicalCareController?enc_id=501&fac_id=7');
    expect(result.summary).toEqual([
      expect.objectContaining({ run: '111111111', hospitalizations: 2, downloaded: 4, failed: 0 }),
    ]);
  });

  it('reads hospital days in Rapa Nui time, globally or per RUT', async () => {
    const lateNight = row({
      encounterId: 601,
      patientIdentifier: '123456785',
      patientName: 'Paciente Prueba Dos',
      // 01:30 on the mainland is 23:30 of June 30 in Rapa Nui.
      startPeriod: '2026-06-20T08:00:00.00-04:00',
      endPeriod: '2026-07-01T01:30:00.0-04:00',
    });
    const { runtime, archive } = makeRuntime({
      history: { '111111111': [discharged], '123456785': [lateNight] },
      pharmacological: { '111111111': [discharged], '123456785': [lateNight] },
    });

    const result = await runtime.handleRequest({
      requestId: 'req-2',
      patients: [
        { run: PATIENT_A, dateFrom: '2026-07-01', dateTo: '2026-07-31' },
        { run: PATIENT_B, dateFrom: '2026-07-01', dateTo: '2026-07-31' },
      ],
      documentTypes: ['history'],
    });

    expect(result).toMatchObject({ ok: true, documentCount: 1 });
    expect(Object.keys(archive())).toEqual([
      '00 Resumen.csv',
      'Paciente Prueba Uno - 11111111-1 - Historial hospitalizacion - ingreso 2026-07-13.pdf',
    ]);
    const summary = strFromU8(archive()['00 Resumen.csv']);
    expect(summary).toContain('12345678-5;;;;;Sin hospitalizaciones en el periodo;');
  });

  it('reports a RUT whose list Eloísa did not deliver as a failure, not as no hospitalizations', async () => {
    const { runtime, archive } = makeRuntime({
      history: { '111111111': [discharged], '123456785': 500 },
    });

    const result = await runtime.handleRequest({
      requestId: 'req-3',
      patients: [{ run: PATIENT_A }, { run: PATIENT_B }],
      documentTypes: ['history'],
    });

    expect(result.ok).toBe(true);
    expect(result.summary?.[1]).toMatchObject({
      run: '123456785',
      error: expect.stringContaining('HTTP 500'),
    });
    const summary = strFromU8(archive()['00 Resumen.csv']);
    expect(summary).toContain('12345678-5;;;;;No se pudo consultar Eloísa');
    expect(summary).not.toContain('12345678-5;;;;;Sin hospitalizaciones');
  });

  it('marks a single report Eloísa did not deliver and still saves the rest', async () => {
    const { runtime, archive } = makeRuntime({
      pdfStatus: url =>
        url.pathname.endsWith('GetPharmacologicalCareController') &&
        url.searchParams.get('enc_id') === '502'
          ? { error: 'HTTP 504' }
          : null,
    });

    const result = await runtime.handleRequest({
      requestId: 'req-4',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });

    expect(result).toMatchObject({ ok: true, documentCount: 3, failedCount: 1 });
    expect(strFromU8(archive()['00 Resumen.csv'])).toContain('No descargado: HTTP 504');
  });

  it('saves nothing when Eloísa rejects the session', async () => {
    const { runtime, zipChunks } = makeRuntime({
      pdfStatus: () => ({ fatal: true, error: 'Eloísa no autorizó el informe.' }),
    });

    const result = await runtime.handleRequest({
      requestId: 'req-5',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });

    expect(result.ok).not.toBe(true);
    expect(result.error).toContain('Eloísa no autorizó');
    expect(zipChunks()).toEqual([]);
  });

  it('refuses more than the document limit before downloading any report', async () => {
    const many = Array.from({ length: 51 }, (_unused, index) =>
      row({
        encounterId: 1000 + index,
        patientIdentifier: '111111111',
        patientName: 'Paciente Prueba Uno',
        startPeriod: `2020-01-${String((index % 28) + 1).padStart(2, '0')}T10:00:00.00-03:00`,
        endPeriod: '2020-02-01T10:00:00.00-03:00',
      })
    );
    const { runtime, fetchOfficialPdf, zipChunks } = makeRuntime({
      history: { '111111111': many },
      pharmacological: { '111111111': [] },
    });

    const result = await runtime.handleRequest({
      requestId: 'req-6',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });

    expect(result.error).toContain('102 documentos');
    expect(fetchOfficialPdf).not.toHaveBeenCalled();
    expect(zipChunks()).toEqual([]);
  });

  it.each([
    ['more than 20 RUTs', { patients: Array.from({ length: 21 }, () => ({ run: PATIENT_A })) }],
    ['a wrong verifier digit', { patients: [{ run: '11111111-2' }] }],
    ['a repeated RUT', { patients: [{ run: PATIENT_A }, { run: '11.111.111-1' }] }],
    [
      'an inverted range',
      { patients: [{ run: PATIENT_A, dateFrom: '2026-08-01', dateTo: '2026-07-01' }] },
    ],
    ['no document type', { patients: [{ run: PATIENT_A }], documentTypes: [] }],
  ])('rejects %s without asking Eloísa', async (_case, request) => {
    const { runtime, fetchWithTimeout } = makeRuntime();

    const result = await runtime.handleRequest({
      requestId: 'req-7',
      documentTypes: BOTH,
      ...request,
    });

    expect(result.error).toEqual(expect.any(String));
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('stops without saving when HHR cancels or the session changes mid-download', async () => {
    let runtime: AuditRuntime | null = null;
    const setup = makeRuntime({
      pdfStatus: () => {
        runtime?.cancelAll();
        return null;
      },
    });
    runtime = setup.runtime;

    const result = await runtime.handleRequest({
      requestId: 'req-8',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });

    expect(result).toMatchObject({ cancelled: true });
    expect(setup.fetchOfficialPdf).toHaveBeenCalledTimes(1);
    expect(setup.zipChunks()).toEqual([]);
  });

  it('accepts a bulk export only from an HHR tab', async () => {
    const { runtime, fetchWithTimeout } = makeRuntime();

    const result = await runtime.handleRequest({
      requestId: 'req-13',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
      sender: { tab: { id: 7, url: 'https://fichamedico.rayensalud.cl/dashboard' }, frameId: 0 },
    });

    expect(result.error).toBe('La descarga para auditoría solo se puede pedir desde HHR.');
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('keeps a name from running as a formula when the summary opens in a spreadsheet', async () => {
    const formula = { ...discharged, patientName: '=HYPERLINK("http://example.test")' };
    const { runtime, archive } = makeRuntime({
      history: { '111111111': [formula] },
      pharmacological: { '111111111': [] },
    });

    await runtime.handleRequest({
      requestId: 'req-14',
      patients: [{ run: PATIENT_A }],
      documentTypes: ['history'],
    });

    const summary = strFromU8(archive()['00 Resumen.csv']);
    expect(summary).toContain(`;"'=HYPERLINK(""http://example.test"")";`);
  });

  it('hands a large ZIP to the HHR tab in parts that rebuild the same archive', async () => {
    const { runtime, archive, zipChunks } = makeRuntime({ pdfBytes: 2_500_000 });

    const result = await runtime.handleRequest({
      requestId: 'req-11',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });

    expect(result.ok).toBe(true);
    expect(zipChunks().map(chunk => [chunk.index, chunk.total])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
    expect(Object.keys(archive())).toHaveLength(5);
  });

  it('does not report a ZIP as saved when the HHR tab does not confirm it', async () => {
    const { runtime } = makeRuntime({ tabReply: () => undefined });

    const result = await runtime.handleRequest({
      requestId: 'req-12',
      patients: [{ run: PATIENT_A }],
      documentTypes: BOTH,
    });

    expect(result.ok).not.toBe(true);
    expect(result.error).toContain('No se pudo guardar el ZIP en HHR');
  });

  it('sends progress with the type the HHR bridge listens for', () => {
    expect(globals.HhrAuditDocumentsRuntime.PROGRESS_MESSAGE_TYPE).toBe(
      globals.HhrRayenMessageContract.types.AUDIT_DOCUMENTS_PROGRESS
    );
  });

  it('runs one audit download at a time', async () => {
    const { runtime } = makeRuntime();

    const [first, second] = await Promise.all([
      runtime.handleRequest({
        requestId: 'req-9',
        patients: [{ run: PATIENT_A }],
        documentTypes: BOTH,
      }),
      runtime.handleRequest({
        requestId: 'req-10',
        patients: [{ run: PATIENT_A }],
        documentTypes: BOTH,
      }),
    ]);

    expect(first.ok).toBe(true);
    expect(second.error).toContain('en curso');
  });
});

describe('stored ZIP writer', () => {
  it('computes the standard CRC-32', () => {
    expect(globals.HhrZipStoreWriter.crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes an archive a standard reader opens with the same bytes', () => {
    const data = new Uint8Array([37, 80, 68, 70, 0, 255, 10]);
    const zip = globals.HhrZipStoreWriter.build(
      [
        { name: 'a.pdf', data },
        { name: 'b c.csv', data: new TextEncoder().encode('x;y') },
      ],
      { year: 2026, month: 11, day: 2, hour: 16, minute: 10, second: 0 }
    );

    const files = unzipSync(zip);
    expect(files['a.pdf']).toEqual(data);
    expect(strFromU8(files['b c.csv'])).toBe('x;y');
  });

  it('refuses names the Windows extractor would garble', () => {
    expect(() =>
      globals.HhrZipStoreWriter.build(
        [{ name: 'Historial hospitalización.pdf', data: new Uint8Array(1) }],
        {
          year: 2026,
          month: 1,
          day: 1,
          hour: 0,
          minute: 0,
          second: 0,
        }
      )
    ).toThrow();
  });
});
