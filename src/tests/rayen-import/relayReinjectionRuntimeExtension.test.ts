// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import '../../../extension/relay-reinjection-operations.js';
import '../../../extension/relay-reinjection-runtime.js';

type ReinjectionRuntime = {
  create: (deps: Record<string, unknown>) => {
    start: () => boolean;
    reinjectRelays: () => Promise<{
      injectedTabs: number;
      failedTabs: number;
      complete: boolean;
    }>;
    reinjectTab: (target: { tabId: number; requiredFile: string }) => Promise<{
      injected: boolean;
      reason?: string;
    }>;
    reinjectRelay: (requiredFile: string) => Promise<{
      injectedTabs: number;
      failedTabs: number;
      complete: boolean;
    }>;
    ensureReinjected: (options?: { force?: boolean }) => Promise<{
      injectedTabs: number;
      skipped: boolean;
      failedTabs?: number;
      complete?: boolean;
    }>;
  };
  STORAGE_KEY: string;
};

const runtimeModule = (globalThis as unknown as { HhrRelayReinjectionRuntime: ReinjectionRuntime })
  .HhrRelayReinjectionRuntime;

const MANIFEST = {
  version: '0.48.31',
  content_scripts: [
    {
      matches: ['https://fichamedico.rayensalud.cl/*'],
      js: [
        'fichamedico-isolation-normalization.js',
        'fichamedico-treating-physician-dom.js',
        'fichamedico-treating-physician-sources.js',
        'fichamedico-treating-physician-normalization.js',
        'fichamedico-normalization.js',
        'fichamedico-read-resilience.js',
        'bridge-generation-main.js',
        'connection-relay-recovery.js',
        'inject-fichamedico.js',
      ],
      world: 'MAIN',
    },
    {
      matches: ['https://fichamedico.rayensalud.cl/*'],
      js: ['message-contract.js', 'bridge-generation.js', 'content-fichamedico.js'],
    },
    {
      matches: ['https://hospitalizado.rayensalud.cl/*'],
      js: ['bridge-generation-main.js', 'connection-relay-recovery.js', 'inject-gestioncamas.js'],
      world: 'MAIN',
    },
    {
      matches: ['https://hospitalizado.rayensalud.cl/*'],
      js: [
        'message-contract.js',
        'bridge-generation.js',
        'gestion-camas-bridge-health.js',
        'content-gestioncamas.js',
      ],
    },
    {
      matches: ['http://localhost:3001/*'],
      js: [
        'message-contract.js',
        'bridge-generation.js',
        'health-push-ordering-runtime.js',
        'content-hhr-sync-bundle.js',
        'content-hhr-connection-repair.js',
        'content-hhr.js',
        'content-hhr-patient-flow.js',
        'content-hhr-epicrisis.js',
        'content-hhr-patient-documents.js',
        'content-hhr-statistical-discharge.js',
        'content-hhr-statistical-evidence.js',
        'content-hhr-syslab.js',
      ],
    },
    {
      matches: ['http://10.4.69.90/syslab/*'],
      js: ['lab-result-parser.js', 'lab-viewer.js', 'syslab-bridge.js'],
      all_frames: true,
    },
  ],
};

const createFixture = () => {
  const installedListeners: Array<() => void> = [];
  const executeScript = vi.fn(
    async (_injection: { target: { tabId: number; allFrames: boolean }; files: string[] }) =>
      undefined
  );
  const sessionState: Record<string, unknown> = {};
  const chromeApi = {
    runtime: {
      getManifest: () => MANIFEST,
      onInstalled: {
        addListener: vi.fn((listener: () => void) => installedListeners.push(listener)),
      },
    },
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionState[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(sessionState, values)),
      },
    },
    tabs: {
      query: vi.fn(async ({ url }: { url: string[] }) =>
        url.includes('https://fichamedico.rayensalud.cl/*')
          ? [{ id: 5, url: 'https://fichamedico.rayensalud.cl/dashboard' }]
          : url.includes('https://hospitalizado.rayensalud.cl/*')
            ? [{ id: 6, url: 'https://hospitalizado.rayensalud.cl/#/bed' }]
            : url.includes('http://10.4.69.90/syslab/*')
              ? [{ id: 9, url: 'http://10.4.69.90/syslab/index.php' }]
              : [{ id: 8, url: 'http://localhost:3001/census' }]
      ),
      get: vi.fn(async (tabId: number) => ({
        id: tabId,
        url:
          tabId === 5
            ? 'https://fichamedico.rayensalud.cl/dashboard'
            : tabId === 6
              ? 'https://hospitalizado.rayensalud.cl/#/bed'
              : tabId === 9
                ? 'http://10.4.69.90/syslab/index.php'
                : 'http://localhost:3001/census',
      })),
      sendMessage: vi.fn(async (tabId: number) => ({
        relayReady: tabId === 5 ? 'fichamedico' : tabId === 6 ? 'gestioncamas' : 'hhr',
      })),
    },
    scripting: { executeScript },
  };
  const onReinjected = vi.fn(async () => undefined);
  const withTimeout = vi.fn(async (promise: Promise<unknown>) => promise);
  const runtime = runtimeModule.create({
    chromeApi,
    onReinjected,
    log: vi.fn(),
    timeoutMs: 5_000,
    withTimeout,
  });
  return {
    runtime,
    chromeApi,
    executeScript,
    onReinjected,
    withTimeout,
    installedListeners,
    sessionState,
  };
};

describe('relay reinjection runtime (extension)', () => {
  it('re-inyecta solo los relés ISOLATED del manifest y avisa al terminar', async () => {
    const { runtime, chromeApi, executeScript, onReinjected } = createFixture();

    await expect(runtime.reinjectRelays()).resolves.toEqual({
      injectedTabs: 4,
      failedTabs: 0,
      complete: true,
    });

    // MAIN restores only its listener; wrappers and captured state stay in the original closure.
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 5, allFrames: false },
      world: 'MAIN',
      files: MANIFEST.content_scripts[0].js,
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 5, allFrames: false },
      files: ['message-contract.js', 'bridge-generation.js', 'content-fichamedico.js'],
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 8, allFrames: false },
      files: MANIFEST.content_scripts[4].js,
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 9, allFrames: true },
      files: ['lab-result-parser.js', 'lab-viewer.js', 'syslab-bridge.js'],
    });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalledWith(9, expect.anything());
    expect(onReinjected).toHaveBeenCalledWith(4);
  });

  it('tolera pestañas que rechazan la inyección y no avisa si no inyectó nada', async () => {
    const { runtime, executeScript, onReinjected } = createFixture();
    executeScript.mockRejectedValue(new Error('pestaña protegida'));

    await expect(runtime.reinjectRelays()).resolves.toEqual({
      injectedTabs: 0,
      failedTabs: 4,
      complete: false,
    });
    expect(onReinjected).not.toHaveBeenCalled();
  });

  it('no marca una reparación parcial y vuelve a intentar en el siguiente arranque', async () => {
    const { runtime, executeScript, sessionState } = createFixture();
    executeScript.mockRejectedValueOnce(new Error('pestaña todavía cargando'));

    await expect(runtime.ensureReinjected()).resolves.toMatchObject({ complete: false });
    expect(sessionState[runtimeModule.STORAGE_KEY]).toBeUndefined();
    executeScript.mockClear();
    await expect(runtime.ensureReinjected()).resolves.toMatchObject({ complete: true });
    expect(executeScript).toHaveBeenCalled();
    expect(sessionState[runtimeModule.STORAGE_KEY]).toBe(MANIFEST.version);
  });

  it('reinyecta al arrancar aunque onInstalled no se emita y lo hace una vez por sesión', async () => {
    const { runtime, executeScript, sessionState } = createFixture();

    expect(runtime.start()).toBe(true);
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalled());
    expect(sessionState[runtimeModule.STORAGE_KEY]).toBe(MANIFEST.version);
    executeScript.mockClear();
    await expect(runtime.ensureReinjected()).resolves.toEqual({ injectedTabs: 0, skipped: true });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('onInstalled fuerza la reparación aunque la sesión ya estuviera marcada', async () => {
    const { runtime, executeScript, installedListeners } = createFixture();
    expect(runtime.start()).toBe(true);
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalled());
    executeScript.mockClear();
    installedListeners.forEach(listener => listener());
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalled());
  });

  it('repairs one exact relay after the session marker and verifies its receiver', async () => {
    const { runtime, executeScript, sessionState, chromeApi } = createFixture();
    sessionState[runtimeModule.STORAGE_KEY] = MANIFEST.version;

    await expect(runtime.ensureReinjected()).resolves.toEqual({ injectedTabs: 0, skipped: true });
    await expect(
      runtime.reinjectTab({ tabId: 5, requiredFile: 'content-fichamedico.js' })
    ).resolves.toEqual({ injected: true });

    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(5, {
      type: 'RAYEN_EXTENSION_RELAY_PING',
    });
  });

  it('repairs only Gestión de Camas when its MAIN health bridge is unresponsive', async () => {
    const { runtime, executeScript, onReinjected } = createFixture();

    await expect(runtime.reinjectRelay('content-gestioncamas.js')).resolves.toEqual({
      injectedTabs: 1,
      failedTabs: 0,
      complete: true,
    });
    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 6, allFrames: false },
      world: 'MAIN',
      files: MANIFEST.content_scripts[2].js,
    });
    expect(onReinjected).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('fails closed when injection does not install the expected receiver', async () => {
    const { runtime, chromeApi } = createFixture();
    chromeApi.tabs.sendMessage.mockResolvedValue({ relayReady: 'stale-relay' });

    await expect(
      runtime.reinjectTab({ tabId: 5, requiredFile: 'content-fichamedico.js' })
    ).resolves.toEqual({ injected: false, reason: 'injection_failed' });
  });

  it('bounds script injection and receiver verification with the configured deadline', async () => {
    const { runtime, withTimeout } = createFixture();

    await expect(
      runtime.reinjectTab({ tabId: 5, requiredFile: 'content-fichamedico.js' })
    ).resolves.toEqual({ injected: true });
    expect(withTimeout.mock.calls.map(call => call.slice(1))).toEqual([
      [5_000, 'No se pudo revalidar la pestaña.'],
      [5_000, 'La reinyección MAIN excedió el tiempo esperado.'],
      [5_000, 'La reinyección ISOLATED excedió el tiempo esperado.'],
      [5_000, 'El relé reinyectado no confirmó su receptor.'],
    ]);
  });

  it('refuses a directed repair after the tab navigated to another host', async () => {
    const { runtime, chromeApi, executeScript } = createFixture();
    chromeApi.tabs.get.mockResolvedValue({ id: 5, url: 'https://hospitalizado.rayensalud.cl/' });

    await expect(
      runtime.reinjectTab({ tabId: 5, requiredFile: 'content-fichamedico.js' })
    ).resolves.toEqual({ injected: false, reason: 'tab_url_mismatch' });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('sin permiso de scripting no arranca', () => {
    const { runtime, chromeApi } = createFixture();
    delete (chromeApi as { scripting?: unknown }).scripting;
    expect(runtime.start()).toBe(false);
  });
});
