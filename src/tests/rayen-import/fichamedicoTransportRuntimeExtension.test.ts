// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/health-check.js';
import '../../../extension/encounter-navigation.js';
import '../../../extension/fichamedico-transport-runtime.js';

type Tab = {
  id?: number;
  active?: boolean;
  lastAccessed?: number;
  url?: string;
  windowId?: number;
};

const globals = globalThis as typeof globalThis & {
  HhrExtensionHealth: {
    orderTabs: (tabs: Tab[]) => Tab[];
    probeTabs: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  };
  HhrEncounterNavigation: {
    normalizeEncounterId: (value: unknown) => string;
    orderEncounterTabs: (tabs: Tab[]) => Tab[];
    buildEncounterUrl: (encounterId: string, currentUrl?: string) => string;
  };
  HhrFichaMedicoTransportRuntime: {
    create: (dependencies: Record<string, unknown>) => {
      sendToMatchingTab: (
        urlMatch: string,
        message: Record<string, unknown>,
        noTabError: string,
        noAnswerError: string
      ) => Promise<Record<string, unknown>>;
      handleSnapshotRequest: () => Promise<Record<string, unknown>>;
      handleOpenEncounter: (
        encId: unknown,
        routeHint?: 'medical' | 'nurse'
      ) => Promise<Record<string, unknown>>;
      health: () => Promise<Record<string, unknown>>;
      getFetchInfo: (sender?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    };
  };
};

const withTimeout = vi.fn(
  async (promise: Promise<unknown>, _timeoutMs: number, _message: string) => promise
);

const makeChrome = () => ({
  tabs: {
    query: vi.fn<() => Promise<Tab[]>>().mockResolvedValue([]),
    sendMessage: vi.fn<(tabId: number, message: Record<string, unknown>) => Promise<unknown>>(),
    update: vi.fn<(tabId: number, update: Record<string, unknown>) => Promise<Tab>>(),
    create: vi.fn<(create: Record<string, unknown>) => Promise<Tab>>(),
  },
  windows: {
    update: vi.fn<(windowId: number, update: Record<string, unknown>) => Promise<unknown>>(),
  },
});

const createRuntime = (chrome = makeChrome()) => ({
  chrome,
  runtime: globals.HhrFichaMedicoTransportRuntime.create({
    chrome,
    extensionHealth: globals.HhrExtensionHealth,
    encounterNavigation: globals.HhrEncounterNavigation,
    withTimeout,
    tabMessageTimeoutMs: 50_000,
    healthProbeTimeoutMs: 5_000,
  }),
});

describe('Ficha Médico transport runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed when a required dependency or timeout is missing', () => {
    expect(() => globals.HhrFichaMedicoTransportRuntime.create({})).toThrow(
      'Falta la dependencia withTimeout.'
    );
    expect(() =>
      globals.HhrFichaMedicoTransportRuntime.create({
        chrome: makeChrome(),
        extensionHealth: globals.HhrExtensionHealth,
        encounterNavigation: globals.HhrEncounterNavigation,
        withTimeout,
        tabMessageTimeoutMs: 0,
        healthProbeTimeoutMs: 5_000,
      })
    ).toThrow('El timeout tabMessageTimeoutMs no es válido.');
  });

  it('tries Ficha tabs in active/recency order with the exact bounded-message contract', async () => {
    const chrome = makeChrome();
    chrome.tabs.query.mockResolvedValue([
      { id: 1, lastAccessed: 500 },
      { id: 2, active: true, lastAccessed: 100 },
      { id: 3, lastAccessed: 300 },
    ]);
    chrome.tabs.sendMessage
      .mockRejectedValueOnce(new Error('stale'))
      .mockResolvedValueOnce({ error: 'sesión vencida' })
      .mockResolvedValueOnce({ snapshot: { encounters: [] } });
    const { runtime } = createRuntime(chrome);

    await expect(runtime.handleSnapshotRequest()).resolves.toEqual({
      snapshot: { encounters: [] },
    });
    expect(chrome.tabs.sendMessage.mock.calls.map(([tabId]) => tabId)).toEqual([2, 1, 3]);
    expect(withTimeout).toHaveBeenCalledTimes(3);
    expect(withTimeout.mock.calls.every(call => call[1] === 50_000)).toBe(true);
    expect(withTimeout.mock.calls[0]?.[2]).toBe(
      'La pestaña de Ficha Médico no respondió dentro del tiempo esperado.'
    );
  });

  it('preserves missing-tab and last-diagnostic snapshot failures', async () => {
    const chrome = makeChrome();
    const { runtime } = createRuntime(chrome);

    await expect(runtime.handleSnapshotRequest()).resolves.toEqual({
      error: 'No hay una pestaña de Rayen (Ficha Médico) abierta. Ábrela e inicia sesión.',
    });

    chrome.tabs.query.mockResolvedValue([{ id: 7 }]);
    chrome.tabs.sendMessage.mockResolvedValue({ error: 'relay no autenticado' });
    await expect(runtime.handleSnapshotRequest()).resolves.toEqual({
      error:
        'No se pudo leer Rayen. Recarga la pestaña de Ficha Médico (Cmd+R) para activar la extensión y reintenta. Detalle: relay no autenticado',
    });
  });

  it('reuses and focuses the preferred encounter tab without failing on focus errors', async () => {
    const chrome = makeChrome();
    chrome.tabs.query.mockResolvedValue([
      {
        id: 8,
        active: true,
        url: 'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse/141000',
      },
      { id: 9, url: 'https://fichamedico.rayensalud.cl/dashboard/encounter-list/141001' },
    ]);
    chrome.tabs.update.mockResolvedValue({ id: 8, windowId: 4 });
    chrome.windows.update.mockRejectedValue(new Error('cannot focus'));
    const { runtime } = createRuntime(chrome);

    await expect(runtime.handleOpenEncounter('141336')).resolves.toEqual({
      ok: true,
      reused: true,
    });
    expect(chrome.tabs.update).toHaveBeenCalledWith(8, {
      url: 'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse/141336',
      active: true,
    });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
    expect(chrome.windows.update).toHaveBeenCalledWith(4, { focused: true });

    await expect(runtime.handleOpenEncounter('invalid')).resolves.toEqual({
      ok: false,
      reused: false,
      error: 'El episodio clínico no es válido.',
    });
  });

  it('opens a canonical encounter tab when none can be reused', async () => {
    const chrome = makeChrome();
    chrome.tabs.create.mockResolvedValue({ id: 10 });
    const { runtime } = createRuntime(chrome);

    await expect(runtime.handleOpenEncounter('141336')).resolves.toEqual({
      ok: true,
      reused: false,
    });
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://fichamedico.rayensalud.cl/dashboard/encounter-list/141336',
      active: true,
    });
  });

  it('opens the nursing encounter route when HHR supplies the manual-import hint', async () => {
    const chrome = makeChrome();
    chrome.tabs.create.mockResolvedValue({ id: 10 });
    const { runtime } = createRuntime(chrome);

    await expect(runtime.handleOpenEncounter('141336', 'nurse')).resolves.toEqual({
      ok: true,
      reused: false,
    });
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse/141336',
      active: true,
    });
  });

  it('keeps the health identity and its shorter timeout unchanged', async () => {
    const chrome = makeChrome();
    chrome.tabs.query.mockResolvedValue([{ id: 5, active: true }]);
    chrome.tabs.sendMessage.mockResolvedValue({
      ready: true,
      message: 'Ficha Médico disponible.',
      identity: { roleId: '2' },
    });
    const { runtime } = createRuntime(chrome);

    await expect(runtime.health()).resolves.toEqual({
      status: 'ready',
      message: 'Ficha Médico disponible.',
      identity: { roleId: '2' },
    });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(5, {
      type: 'RAYEN_EXTENSION_HEALTH_PING',
    });
    expect(withTimeout.mock.calls[0]?.slice(1)).toEqual([
      5_000,
      'La pestaña no respondió a la verificación de conexión.',
    ]);
  });

  it('prefers the verified sender session and otherwise falls back to ordered Ficha tabs', async () => {
    const chrome = makeChrome();
    const info = { token: 'abc', apiOrigin: 'https://fichamedicoback.rayensalud.cl' };
    chrome.tabs.sendMessage.mockResolvedValue({ info });
    const { runtime } = createRuntime(chrome);

    await expect(
      runtime.getFetchInfo({
        tab: { id: 6, url: 'https://fichamedico.rayensalud.cl/dashboard/reports' },
      })
    ).resolves.toEqual({ info });
    expect(chrome.tabs.query).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(6, {
      type: 'RAYEN_FM_GET_FETCH_INFO',
    });

    vi.clearAllMocks();
    chrome.tabs.query.mockResolvedValue([{ id: 11 }]);
    chrome.tabs.sendMessage.mockResolvedValue({ info });
    await expect(runtime.getFetchInfo()).resolves.toEqual({ info });
    expect(chrome.tabs.query).toHaveBeenCalledWith({
      url: 'https://fichamedico.rayensalud.cl/*',
    });
  });

  it('keeps the owner loaded before background wiring and both files within budget', () => {
    const background = readFileSync(path.resolve('extension/background.js'), 'utf8');
    const owner = readFileSync(path.resolve('extension/fichamedico-transport-runtime.js'), 'utf8');
    const startup = background.slice(0, background.indexOf('const REPORT_FILE'));

    expect(startup).toContain("'fichamedico-transport-runtime.js'");
    expect(startup).toContain('No se pudo cargar el runtime de transporte de Ficha Médico.');
    expect(background).toContain(
      'const fichaMedicoTransportRuntime = self.HhrFichaMedicoTransportRuntime.create({'
    );
    expect(background).not.toContain('const fichaSenderTabId');
    expect(background).not.toContain('const handleOpenEncounter = async');
    expect(background.split('\n').length).toBeLessThanOrEqual(3_850);
    expect(owner.split('\n').length).toBeLessThanOrEqual(230);
  });
});
