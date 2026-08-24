// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as PDFLib from 'pdf-lib';

import '../../../extension/syslab-session-transport.js';
import '../../../extension/syslab-pdf-bundle.js';
import '../../../extension/syslab-runtime.js';

type StoredValues = Record<string, unknown>;

const createHarness = (
  sendMessage: ReturnType<typeof vi.fn> = vi.fn(async () => ({
    bridgeId: 'bridge-1',
    loginRequired: false,
  }))
) => {
  const stored: StoredValues = {};
  const createDocument = vi.fn(async () => undefined);
  const downloadPdfBuffer = vi.fn(async () => ({ ok: true, downloadId: 91 }));
  const chromeApi = {
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      getContexts: vi.fn(async () => [
        { documentUrl: 'chrome-extension://test/syslab-offscreen.html' },
      ]),
      sendMessage,
    },
    offscreen: { createDocument },
    storage: {
      session: {
        get: vi.fn(async (key: string | null) => {
          if (key === null) return { ...stored };
          return Object.hasOwn(stored, key) ? { [key]: stored[key] } : {};
        }),
        set: vi.fn(async (values: StoredValues) => Object.assign(stored, values)),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
        }),
      },
    },
    tabs: {
      create: vi.fn(async () => ({ id: 81 })),
      query: vi.fn(async () => []),
      sendMessage: vi.fn(),
    },
  };
  const syslabPdfBundle = globalThis.HhrSyslabPdfBundle.create({
    pdfLib: PDFLib,
    downloadPdfBuffer,
    normalizeRutBody: (value: unknown) =>
      String(value || '')
        .replace(/\./g, '')
        .replace(/-.*$/, '')
        .replace(/\D/g, ''),
  });
  const dependencies = {
    chrome: chromeApi,
    syslabSessionTransport: globalThis.HhrSyslabSessionTransport,
    labViewer: {
      normalizeRutBody: (value: unknown) =>
        String(value || '')
          .replace(/\./g, '')
          .replace(/-.*$/, '')
          .replace(/\D/g, ''),
      examRowsMatchRut: () => true,
      sanitizeExamList: (exams: unknown[]) => exams,
      validateDetailBatch: (details: unknown[]) => details,
      buildAnalysis: (details: unknown[]) => ({ details }),
    },
    syslabPdfBundle,
    withTimeout: <T>(promise: Promise<T>) => promise,
  };
  const runtime = globalThis.HhrSyslabRuntime.create(dependencies);
  return { chromeApi, createDocument, dependencies, downloadPdfBuffer, runtime, stored };
};

describe('Syslab background runtime', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('reports an existing connected offscreen session without opening a visible tab', async () => {
    const { chromeApi, createDocument, runtime } = createHarness();

    await expect(runtime.currentSession()).resolves.toMatchObject({
      ok: true,
      status: 'ready',
      connected: true,
      pdfBundleSupported: true,
    });
    expect(createDocument).not.toHaveBeenCalled();
    expect(chromeApi.tabs.create).not.toHaveBeenCalled();
  });

  it('validates login input before sending credentials to the offscreen bridge', async () => {
    const sendMessage = vi.fn();
    const { runtime } = createHarness(sendMessage);

    await expect(runtime.login({ username: ' ', password: '' })).resolves.toEqual({
      error: 'Ingresa usuario y contraseña para conectar Syslab.',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('rejects a verifier digit before contacting Syslab', async () => {
    const sendMessage = vi.fn();
    const { runtime } = createHarness(sendMessage);

    await expect(
      runtime.search({ rutBody: '29219852-3', sender: { tab: { id: 44 } } })
    ).resolves.toEqual({
      error: 'HHR no informó un RUT válido, sin dígito verificador, para Syslab.',
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('stores a successful RUT-body search in a batch bound to the HHR tab', async () => {
    const sendMessage = vi.fn(async ({ request }: { request: { type: string } }) => {
      if (request.type === 'RAYEN_SYSLAB_STATUS') {
        return { bridgeId: 'bridge-1', loginRequired: false };
      }
      if (request.type === 'RAYEN_SYSLAB_READ_RESULTS') {
        return {
          rutBody: '12345678',
          exams: [
            {
              id: 'exam-1',
              link: '/report/exam-1',
              date: '17-07-2026',
              time: '08:30',
              patientName: 'Paciente',
              origin: 'HHR',
              exams: ['Hemograma'],
            },
          ],
        };
      }
      return { navigated: false };
    });
    const { runtime, stored } = createHarness(sendMessage);

    const result = await runtime.search({
      rutBody: '12345678',
      sender: { tab: { id: 44, url: 'http://localhost:3000/' } },
    });

    expect(result).toMatchObject({ ok: true, rutBody: '12345678' });
    const batchKey = Object.keys(stored).find(key => key.startsWith('hhr-lab-batch-'));
    expect(batchKey).toBeDefined();
    expect(stored[batchKey!]).toMatchObject({
      senderTabId: 44,
      rutBody: '12345678',
      linksByExamId: { 'exam-1': '/report/exam-1' },
    });
  });

  it('validates and merges selected reports before downloading one PDF', async () => {
    const source = await PDFLib.PDFDocument.create();
    source.addPage();
    source.addPage();
    const pdfBase64 = Buffer.from(await source.save()).toString('base64');
    const sendMessage = vi.fn(async ({ request }: { request: { type: string } }) => {
      if (request.type === 'RAYEN_SYSLAB_STATUS') {
        return { bridgeId: 'bridge-1', loginRequired: false };
      }
      if (request.type === 'RAYEN_SYSLAB_READ_RESULTS') {
        return {
          rutBody: '12345678',
          exams: [
            {
              id: '43091284',
              link: '/syslab/detalleexamenes.php?id=43091284',
              date: '17-07-2026',
              time: '08:30',
              patientName: 'Paciente',
              origin: 'HHR',
              exams: ['Hemograma'],
            },
          ],
        };
      }
      if (request.type === 'RAYEN_SYSLAB_VALIDATE_REPORT') {
        return { rutBody: '12345678', pdfBase64 };
      }
      return { navigated: false };
    });
    const { downloadPdfBuffer, runtime } = createHarness(sendMessage);
    const search = await runtime.search({
      rutBody: '12345678',
      sender: { tab: { id: 44, url: 'http://localhost:3000/' } },
    });

    await expect(
      runtime.downloadPdfBundle({
        batchId: search.batchId,
        examIds: ['43091284'],
        sender: { tab: { id: 44 } },
      })
    ).resolves.toEqual({ ok: true, downloadId: 91 });

    expect(downloadPdfBuffer).toHaveBeenCalledWith({
      buffer: expect.any(Uint8Array),
      filename: 'Examenes_Syslab_seleccionados.pdf',
    });
    const downloadCalls = downloadPdfBuffer.mock.calls as unknown as Array<
      [{ buffer: Uint8Array }]
    >;
    const merged = await PDFLib.PDFDocument.load(downloadCalls[0][0].buffer);
    expect(merged.getPageCount()).toBe(2);
  });

  it('shrinks each report timeout so a large bundle stays within the page deadline', async () => {
    const source = await PDFLib.PDFDocument.create();
    source.addPage();
    const pdfBase64 = Buffer.from(await source.save()).toString('base64');
    const downloadPdfBuffer = vi.fn(async () => ({ ok: true, downloadId: 91 }));
    const bundle = globalThis.HhrSyslabPdfBundle.create({
      pdfLib: PDFLib,
      downloadPdfBuffer,
      normalizeRutBody: (value: unknown) => String(value || ''),
    });
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(8 * 60_000 + 1);

    const sendWithVisibleFallback = vi.fn(
      async (_session: unknown, _message: unknown, _timeoutMs: number) => ({
        rutBody: '12345678',
        pdfBase64,
      })
    );
    await expect(
      bundle.download({
        batch: {
          rutBody: '12345678',
          linksByExamId: { first: '/first', second: '/second' },
        },
        exams: [{ id: 'first' }, { id: 'second' }],
        session: { kind: 'offscreen', status: { loginRequired: false } },
        sessionTransport: { sendWithVisibleFallback },
        reportTimeoutMs: 90_000,
      })
    ).resolves.toEqual({ ok: true, downloadId: 91 });
    expect(sendWithVisibleFallback.mock.calls[0][2]).toBe(90_000);
    expect(sendWithVisibleFallback.mock.calls[1][2]).toBe(1_000);
  });
});

declare global {
  var HhrSyslabSessionTransport: {
    create: (dependencies: Record<string, unknown>) => Record<string, unknown>;
  };
  var HhrSyslabRuntime: {
    create: (dependencies: Record<string, unknown>) => {
      currentSession: () => Promise<Record<string, unknown>>;
      login: (input: { username: string; password: string }) => Promise<Record<string, unknown>>;
      search: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
      downloadPdfBundle: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
  };
  var HhrSyslabPdfBundle: {
    create: (dependencies: Record<string, unknown>) => {
      createHandler: (
        ...args: unknown[]
      ) => (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
      download: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
    createRuntime: (dependencies: Record<string, unknown>) => Record<string, unknown>;
  };
}
