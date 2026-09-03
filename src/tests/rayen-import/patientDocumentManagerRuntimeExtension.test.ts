// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/encounter-navigation.js';
import '../../../extension/patient-document-manager-runtime.js';

type Tab = { id?: number; active?: boolean; lastAccessed?: number; url?: string; windowId?: number };
const globals = globalThis as typeof globalThis & {
  HhrEncounterNavigation: Record<string, unknown>;
  HhrPatientDocumentManagerRuntime: {
    create: (dependencies: Record<string, unknown>) => {
      handleRequest: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
      count: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
      open: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
      acknowledge: (request: Record<string, unknown>) => Record<string, unknown>;
    };
  };
};

const makeChrome = () => ({
  tabs: {
    query: vi.fn<() => Promise<Tab[]>>().mockResolvedValue([]),
    update: vi.fn<(tabId: number, update: Record<string, unknown>) => Promise<Tab>>(),
    create: vi.fn<(create: Record<string, unknown>) => Promise<Tab>>(),
  },
  windows: { update: vi.fn<(windowId: number, update: Record<string, unknown>) => Promise<unknown>>() },
});

const makeRuntime = () => {
  const chrome = makeChrome();
  const getClinicalReportContext = vi.fn().mockResolvedValue({
    info: { token: 'secret', apiOrigin: 'https://api.example.test' },
    patientId: '9001',
  });
  const readJson = vi.fn().mockResolvedValue({ data: [] });
  const fetchClaims = vi.fn().mockResolvedValue({
    claims: [
      { claim: 'Ver_Repositorio_Documental_Clinico', moduleId: 6 },
      { claim: 'Ver_Repositorio_Documental_Administrativo', moduleId: 6 },
    ],
  });
  const hasClaim = vi.fn((result: { claims: Array<{ claim: string }> }, name: string) =>
    result.claims.some(item => item.claim === name)
  );
  const runtime = globals.HhrPatientDocumentManagerRuntime.create({
    chrome,
    encounterNavigation: globals.HhrEncounterNavigation,
    getClinicalReportContext,
    readJson,
    fetchClaims,
    hasClaim,
  });
  return { chrome, getClinicalReportContext, readJson, fetchClaims, hasClaim, runtime };
};

describe('patient document manager extension runtime', () => {
  beforeEach(() => vi.clearAllMocks());

  it('counts only active documents after resolving the patient from the encounter', async () => {
    const { runtime, getClinicalReportContext, readJson } = makeRuntime();
    readJson.mockResolvedValue({
      data: [{ id: 1 }, { id: 2, deleted: true }, { id: 3, isDeleted: 1 }, { id: 4 }],
    });

    await expect(runtime.count({ encId: '141121', sender: { tab: { id: 7 } } })).resolves.toEqual({
      ok: true,
      count: 2,
    });
    expect(getClinicalReportContext).toHaveBeenCalledWith(
      '141121',
      null,
      null,
      { tab: { id: 7 } }
    );
    expect(readJson).toHaveBeenCalledWith({
      info: { token: 'secret', apiOrigin: 'https://api.example.test' },
      path: '/api/evolutionary/9001',
      cache: 'no-store',
    });
  });

  it('matches Eloisa visibility claims before displaying the count', async () => {
    const { runtime, readJson, fetchClaims } = makeRuntime();
    readJson.mockResolvedValue({
      data: [{ id: 1, classId: 1 }, { id: 2, classId: 2 }, { id: 3, classId: 3 }],
    });
    fetchClaims.mockResolvedValue({
      claims: [{ claim: 'Ver_Repositorio_Documental_Clinico', moduleId: 6 }],
    });

    await expect(runtime.count({ encId: '141121' })).resolves.toEqual({ ok: true, count: 1 });
  });

  it('fails closed for an invalid document payload instead of displaying zero', async () => {
    const { runtime, readJson } = makeRuntime();
    readJson.mockResolvedValue({ data: { unexpected: true } });
    await expect(runtime.count({ encId: '141121' })).resolves.toEqual({
      ok: false,
      error: 'Eloísa no entregó una lista válida de documentos del paciente.',
    });
  });

  it('reuses the preferred tab and adds the one-shot document-manager marker', async () => {
    const { runtime, chrome } = makeRuntime();
    chrome.tabs.query.mockResolvedValue([
      {
        id: 8,
        active: true,
        url: 'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse/140000',
      },
    ]);
    chrome.tabs.update.mockResolvedValue({ id: 8, windowId: 3 });

    const pending = runtime.open({ encId: '141121', routeHint: 'nurse' });
    await vi.waitFor(() => expect(chrome.tabs.update).toHaveBeenCalledOnce());
    const targetUrl = new URL(String(chrome.tabs.update.mock.calls[0]?.[1].url));
    expect(runtime.acknowledge({
      requestId: targetUrl.searchParams.get('hhrOpenDocumentManager'),
      opened: true,
      sender: { url: targetUrl.toString() },
    })).toEqual({ ok: true });
    await expect(pending).resolves.toEqual({
      ok: true,
      opened: true,
      reused: true,
    });
    expect(chrome.tabs.update).toHaveBeenCalledWith(8, {
      url: expect.stringMatching(/^https:\/\/fichamedico\.rayensalud\.cl\/dashboard\/encounter-list-nurse\/141121\?hhrOpenDocumentManager=hhr-documents-/),
      active: true,
    });
    expect(chrome.windows.update).toHaveBeenCalledWith(3, { focused: true });
  });

  it('accepts acknowledgements only from Ficha Médico', async () => {
    const { runtime } = makeRuntime();
    expect(runtime.acknowledge({
      requestId: 'request-1',
      opened: true,
      sender: { url: 'http://localhost:3001/census' },
    })).toEqual({ ok: false, error: 'La confirmación no proviene de Ficha Médico.' });
  });

  it('surfaces a relay failure instead of reporting the manager as opened', async () => {
    const { runtime, chrome } = makeRuntime();
    chrome.tabs.create.mockResolvedValue({ id: 10 });
    const pending = runtime.open({ encId: '141121' });
    await vi.waitFor(() => expect(chrome.tabs.create).toHaveBeenCalledOnce());
    const targetUrl = new URL(String(chrome.tabs.create.mock.calls[0]?.[0].url));
    runtime.acknowledge({
      requestId: targetUrl.searchParams.get('hhrOpenDocumentManager'),
      opened: false,
      error: 'Control no disponible.',
      sender: { url: targetUrl.toString() },
    });

    await expect(pending).resolves.toEqual({
      ok: false,
      opened: false,
      reused: false,
      error: 'Control no disponible.',
    });
  });

  it('rejects unknown operations and invalid episodes', async () => {
    const { runtime } = makeRuntime();
    await expect(runtime.handleRequest({ encId: '141121', operation: 'delete' })).resolves.toEqual({
      ok: false,
      error: 'La operación del Gestor documental no es válida.',
    });
    await expect(runtime.open({ encId: 'bad' })).resolves.toMatchObject({
      ok: false,
      opened: false,
      error: 'El episodio clínico no es válido.',
    });
  });
});
