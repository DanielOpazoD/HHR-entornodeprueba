// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    tabs: { create: vi.fn(async () => ({ id: 81 })) },
  };
  const dependencies = {
    chrome: chromeApi,
    labViewer: {
      normalizePatientRutBody: (value: unknown) => {
        const compact = String(value || '').replace(/\D/g, '');
        return compact.length === 9 ? compact.slice(0, -1) : compact;
      },
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
    withTimeout: <T>(promise: Promise<T>) => promise,
    getClinicalReportContext: vi.fn(async () => ({ patient: { run: '12.345.678-5' } })),
    getFichaFetchInfo: vi.fn(async () => ({ info: { token: 'transient' } })),
    fichaSessionCacheKey: vi.fn(async () => 'session'),
    fetchActiveEncounterRows: vi.fn(async () => ({ rows: [] })),
    resolveFichaEncounterId: vi.fn(() => '141121'),
  };
  const runtime = globalThis.HhrSyslabRuntime.create(dependencies);
  return { chromeApi, createDocument, dependencies, runtime, stored };
};

describe('Syslab background runtime', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('reports an existing connected offscreen session without opening a visible tab', async () => {
    const { chromeApi, createDocument, runtime } = createHarness();

    await expect(runtime.currentSession()).resolves.toMatchObject({
      ok: true,
      status: 'ready',
      connected: true,
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

  it('stores a successful search in an expiring batch bound to the encounter', async () => {
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
      encId: '141121',
      sender: { tab: { url: 'https://fichamedico.rayensalud.cl/dashboard/encounter-list/141121' } },
    });

    expect(result).toMatchObject({ ok: true, patient: { run: '12.345.678-5' } });
    const batchKey = Object.keys(stored).find(key => key.startsWith('hhr-lab-batch-'));
    expect(batchKey).toBeDefined();
    expect(stored[batchKey!]).toMatchObject({
      encounterId: '141121',
      rutBody: '12345678',
      linksByExamId: { 'exam-1': '/report/exam-1' },
    });
  });
});

declare global {
  var HhrSyslabRuntime: {
    create: (dependencies: Record<string, unknown>) => {
      currentSession: () => Promise<Record<string, unknown>>;
      login: (input: { username: string; password: string }) => Promise<Record<string, unknown>>;
      search: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
  };
}
