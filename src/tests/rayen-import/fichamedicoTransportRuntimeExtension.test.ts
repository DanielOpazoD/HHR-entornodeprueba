// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/health-check.js';
import '../../../extension/encounter-navigation.js';
import '../../../extension/connection-relay-recovery.js';
import '../../../extension/fichamedico-transport-runtime.js';

type Tab = {
  id?: number;
  active?: boolean;
  lastAccessed?: number;
  url?: string;
  windowId?: number;
};

const globals = globalThis as typeof globalThis & {
  HhrConnectionRelayRecovery: {
    repairHealth: (
      readHealth: (...args: unknown[]) => Promise<Record<string, unknown>>,
      recover: () => Promise<Record<string, unknown>>
    ) => (...args: unknown[]) => Promise<Record<string, unknown>>;
  };
  HhrExtensionHealth: {
    orderTabs: (tabs: Tab[]) => Tab[];
    resolveTabs: (
      tabsApi: { query: (query: unknown) => Promise<Tab[]>; get: (id: number) => Promise<Tab> },
      url: string,
      targetTabIds?: number[]
    ) => Promise<Tab[]>;
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
      health: (
        runtimeGeneration?: string,
        targetTabIds?: number[]
      ) => Promise<Record<string, unknown>>;
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
    get: vi.fn<(tabId: number) => Promise<Tab>>(),
    sendMessage: vi.fn<(tabId: number, message: Record<string, unknown>) => Promise<unknown>>(),
    update: vi.fn<(tabId: number, update: Record<string, unknown>) => Promise<Tab>>(),
    create: vi.fn<(create: Record<string, unknown>) => Promise<Tab>>(),
  },
  windows: {
    update: vi.fn<(windowId: number, update: Record<string, unknown>) => Promise<unknown>>(),
  },
});

const createRuntime = (
  chrome = makeChrome(),
  recoverMissingReceiver?: (tabId: number) => Promise<{ injected: boolean }>
) => ({
  chrome,
  runtime: globals.HhrFichaMedicoTransportRuntime.create({
    chrome,
    extensionHealth: globals.HhrExtensionHealth,
    encounterNavigation: globals.HhrEncounterNavigation,
    withTimeout,
    tabMessageTimeoutMs: 50_000,
    healthProbeTimeoutMs: 5_000,
    recoverMissingReceiver,
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

  it('retries Gestión de Camas health once only for an unresponsive MAIN bridge', async () => {
    const readHealth = vi
      .fn()
      .mockResolvedValueOnce({
        ready: false,
        reason: 'outdated_tab',
        message: 'El puente interno no respondió.',
      })
      .mockResolvedValueOnce({ ready: true, reason: 'connected' });
    const recover = vi.fn(async () => ({ injectedTabs: 1 }));
    const health = globals.HhrConnectionRelayRecovery.repairHealth(readHealth, recover);

    await expect(health('generation')).resolves.toEqual({ ready: true, reason: 'connected' });
    expect(readHealth).toHaveBeenCalledTimes(2);
    expect(readHealth).toHaveBeenNthCalledWith(1, 'generation');
    expect(readHealth).toHaveBeenNthCalledWith(2, 'generation');
    expect(recover).toHaveBeenCalledOnce();
  });

  it('preflights Ficha tabs in parallel and reads only the preferred healthy tab', async () => {
    const chrome = makeChrome();
    chrome.tabs.query.mockResolvedValue([
      { id: 1, lastAccessed: 500 },
      { id: 2, active: true, lastAccessed: 100 },
      { id: 3, lastAccessed: 300 },
    ]);
    chrome.tabs.sendMessage.mockImplementation(async (tabId, message) => {
      if (message.type === 'RAYEN_EXTENSION_HEALTH_PING') {
        if (tabId === 2) throw new Error('stale');
        if (tabId === 1) return { ready: false, message: 'sesión vencida' };
        return { ready: true };
      }
      return { snapshot: { encounters: [] } };
    });
    const { runtime } = createRuntime(chrome);

    await expect(runtime.handleSnapshotRequest()).resolves.toEqual({
      snapshot: { encounters: [] },
    });
    expect(chrome.tabs.sendMessage.mock.calls.map(([tabId]) => tabId)).toEqual([2, 1, 3, 3]);
    expect(
      chrome.tabs.sendMessage.mock.calls.filter(([, message]) => message.type === 'RAYEN_READ')
    ).toEqual([[3, { type: 'RAYEN_READ' }]]);
    expect(withTimeout.mock.calls.slice(0, 3).every(call => call[1] === 5_000)).toBe(true);
    expect(withTimeout.mock.calls[3]?.slice(1)).toEqual([
      50_000,
      'La pestaña de Ficha Médico no respondió dentro del tiempo esperado.',
    ]);
    expect(withTimeout.mock.calls[0]?.[2]).toBe(
      'La pestaña no respondió a la verificación de conexión.'
    );
  });

  it('keeps the ordered read fallback for relays without the health handshake', async () => {
    const chrome = makeChrome();
    chrome.tabs.query.mockResolvedValue([
      { id: 1, lastAccessed: 500 },
      { id: 2, active: true, lastAccessed: 100 },
    ]);
    chrome.tabs.sendMessage.mockImplementation(async (tabId, message) => {
      if (message.type === 'RAYEN_EXTENSION_HEALTH_PING') {
        throw new Error('health no soportado');
      }
      return tabId === 2 ? { error: 'relay antiguo inactivo' } : { snapshot: { encounters: [] } };
    });
    const { runtime } = createRuntime(chrome);

    await expect(runtime.handleSnapshotRequest()).resolves.toEqual({
      snapshot: { encounters: [] },
    });
    expect(
      chrome.tabs.sendMessage.mock.calls
        .filter(([, message]) => message.type === 'RAYEN_READ')
        .map(([tabId]) => tabId)
    ).toEqual([2, 1]);
    expect(withTimeout.mock.calls.at(-1)?.[2]).toBe(
      'La pestaña de Ficha Médico no respondió dentro del tiempo esperado.'
    );
  });

  it('repairs only a missing receiver, verifies it, and then reads that tab', async () => {
    const chrome = makeChrome();
    chrome.tabs.query.mockResolvedValue([{ id: 7, active: true }]);
    let probeAttempts = 0;
    chrome.tabs.sendMessage.mockImplementation(async (_tabId, message) => {
      if (message.type === 'RAYEN_EXTENSION_HEALTH_PING' && probeAttempts++ === 0) {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }
      return message.type === 'RAYEN_EXTENSION_HEALTH_PING'
        ? { ready: true }
        : { snapshot: { encounters: [] } };
    });
    const recover = vi.fn(async () => ({ injected: true }));

    await expect(createRuntime(chrome, recover).runtime.handleSnapshotRequest()).resolves.toEqual({
      snapshot: { encounters: [] },
    });
    expect(recover).toHaveBeenCalledExactlyOnceWith(7);
    expect(probeAttempts).toBe(2);
  });

  it('reactivates an exact unresponsive MAIN bridge once and verifies it before reading', async () => {
    const chrome = makeChrome();
    chrome.tabs.query.mockResolvedValue([{ id: 7, active: true }]);
    let probes = 0;
    chrome.tabs.sendMessage.mockImplementation(async (_tabId, message) => {
      if (message.type === 'RAYEN_EXTENSION_HEALTH_PING') {
        probes += 1;
        return probes === 1
          ? {
              ready: false,
              reason: 'outdated_tab',
              message: 'Abre una pestaña nueva: el puente interno no respondió.',
            }
          : { ready: true };
      }
      return { snapshot: { encounters: [] } };
    });
    const recover = vi.fn(async () => ({ injected: true }));

    await expect(createRuntime(chrome, recover).runtime.handleSnapshotRequest()).resolves.toEqual({
      snapshot: { encounters: [] },
    });
    expect(recover).toHaveBeenCalledExactlyOnceWith(7);
    expect(probes).toBe(2);
  });

  it('falls back across tabs when a missing receiver cannot be repaired', async () => {
    const chrome = makeChrome();
    chrome.tabs.query.mockResolvedValue([{ id: 7, active: true }, { id: 8 }]);
    chrome.tabs.sendMessage.mockImplementation(async (tabId, message) => {
      if (message.type === 'RAYEN_EXTENSION_HEALTH_PING') {
        if (tabId === 7) {
          throw new Error('Could not establish connection. Receiving end does not exist.');
        }
        return { ready: true };
      }
      return { snapshot: { encounters: [] } };
    });
    const recover = vi.fn(async () => ({ injected: false }));

    await expect(createRuntime(chrome, recover).runtime.handleSnapshotRequest()).resolves.toEqual({
      snapshot: { encounters: [] },
    });
    expect(recover).toHaveBeenCalledExactlyOnceWith(7);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(8, { type: 'RAYEN_READ' });
  });

  it('does not reinject for an expired session or a generic timeout', async () => {
    const chrome = makeChrome();
    chrome.tabs.query.mockResolvedValue([{ id: 7 }]);
    const recover = vi.fn(async () => ({ injected: true }));
    chrome.tabs.sendMessage.mockResolvedValueOnce({
      ready: false,
      reason: 'session_expired',
      message: 'Sesión vencida',
    });
    await createRuntime(chrome, recover).runtime.handleSnapshotRequest();

    chrome.tabs.sendMessage.mockRejectedValueOnce(new Error('Tiempo de espera agotado'));
    await createRuntime(chrome, recover).runtime.handleSnapshotRequest();
    expect(recover).not.toHaveBeenCalled();
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
      reason: 'connected',
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

  it('scopes clean-repair health to the exact new Ficha Médico tab', async () => {
    const chrome = makeChrome();
    chrome.tabs.query.mockResolvedValue([{ id: 5, active: true }, { id: 8 }]);
    chrome.tabs.get.mockResolvedValue({ id: 8, url: 'https://login.rayensalud.cl/' });
    chrome.tabs.sendMessage.mockResolvedValue({ ready: true, message: 'Ficha nueva disponible.' });
    const { runtime } = createRuntime(chrome);

    await expect(runtime.health('generation', [8])).resolves.toMatchObject({ status: 'ready' });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(8, {
      type: 'RAYEN_EXTENSION_HEALTH_PING',
      runtimeGeneration: 'generation',
    });
    expect(chrome.tabs.query).not.toHaveBeenCalled();
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
