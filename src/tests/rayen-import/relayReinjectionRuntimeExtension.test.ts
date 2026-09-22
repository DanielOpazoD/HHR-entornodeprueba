// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

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
  version: '0.48.27',
  content_scripts: [
    {
      matches: ['https://fichamedico.rayensalud.cl/*'],
      js: ['inject-fichamedico.js'],
      world: 'MAIN',
    },
    {
      matches: ['https://fichamedico.rayensalud.cl/*'],
      js: [
        'message-contract.js',
        'bridge-generation.js',
        'content-fichamedico.js',
        'unsafe-helper.js',
      ],
    },
    {
      matches: ['https://hospitalizado.rayensalud.cl/*'],
      js: [
        'message-contract.js',
        'bridge-generation.js',
        'gestion-camas-bridge-health.js',
        'content-gestioncamas.js',
        'unsafe-helper.js',
      ],
    },
    {
      matches: ['http://localhost:3001/*'],
      js: [
        'message-contract.js',
        'bridge-generation.js',
        'health-push-ordering-runtime.js',
        'content-hhr-sync-bundle.js',
        'content-hhr.js',
        'unsafe-clinical-action.js',
      ],
    },
    { matches: ['http://10.4.69.90/syslab/*'], js: ['syslab-bridge.js'], all_frames: true },
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
          ? [{ id: 5 }]
          : url.includes('https://hospitalizado.rayensalud.cl/*')
            ? [{ id: 6 }]
            : [{ id: 8 }]
      ),
      sendMessage: vi.fn(async (tabId: number) => ({
        relayReady: tabId === 5 ? 'fichamedico' : tabId === 6 ? 'gestioncamas' : 'hhr',
      })),
    },
    scripting: { executeScript },
  };
  const onReinjected = vi.fn(async () => undefined);
  const runtime = runtimeModule.create({ chromeApi, onReinjected, log: vi.fn() });
  return {
    runtime,
    chromeApi,
    executeScript,
    onReinjected,
    installedListeners,
    sessionState,
  };
};

describe('relay reinjection runtime (extension)', () => {
  it('re-inyecta solo los relés ISOLATED del manifest y avisa al terminar', async () => {
    const { runtime, executeScript, onReinjected } = createFixture();

    await expect(runtime.reinjectRelays()).resolves.toEqual({
      injectedTabs: 3,
      failedTabs: 0,
      complete: true,
    });

    // MAIN sólo reactiva su listener conservando el estado y los wrappers existentes.
    const injectedFiles = executeScript.mock.calls.flatMap(call => call[0].files);
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 5, allFrames: false },
      world: 'MAIN',
      files: ['inject-fichamedico.js'],
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 5, allFrames: false },
      files: ['message-contract.js', 'bridge-generation.js', 'content-fichamedico.js'],
    });
    expect(executeScript).not.toHaveBeenCalledWith(
      expect.objectContaining({
        files: expect.arrayContaining(['unsafe-helper.js']),
      })
    );
    expect(injectedFiles).not.toContain('syslab-bridge.js');
    expect(injectedFiles).not.toContain('unsafe-clinical-action.js');
    expect(onReinjected).toHaveBeenCalledWith(3);
  });

  it('tolera pestañas que rechazan la inyección y no avisa si no inyectó nada', async () => {
    const { runtime, executeScript, onReinjected } = createFixture();
    executeScript.mockRejectedValue(new Error('pestaña protegida'));

    await expect(runtime.reinjectRelays()).resolves.toEqual({
      injectedTabs: 0,
      failedTabs: 3,
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

  it('repairs one exact ISOLATED relay even after the worker session was marked', async () => {
    const { runtime, executeScript, sessionState, onReinjected } = createFixture();
    sessionState[runtimeModule.STORAGE_KEY] = MANIFEST.version;

    await expect(runtime.ensureReinjected()).resolves.toEqual({ injectedTabs: 0, skipped: true });
    executeScript.mockClear();
    await expect(
      runtime.reinjectTab({
        tabId: 5,
        requiredFile: 'content-fichamedico.js',
      })
    ).resolves.toEqual({ injected: true });

    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 5, allFrames: false },
      world: 'MAIN',
      files: ['inject-fichamedico.js'],
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 5, allFrames: false },
      files: ['message-contract.js', 'bridge-generation.js', 'content-fichamedico.js'],
    });
    expect(onReinjected).toHaveBeenCalledWith(1);
  });

  it('does not mark an injected script as repaired until its new listener answers', async () => {
    const { runtime, chromeApi, sessionState } = createFixture();
    chromeApi.tabs.sendMessage.mockResolvedValue({ relayReady: 'stale-relay' });

    await expect(runtime.ensureReinjected()).resolves.toMatchObject({
      injectedTabs: 0,
      failedTabs: 3,
      complete: false,
    });
    expect(sessionState[runtimeModule.STORAGE_KEY]).toBeUndefined();
  });

  it('does not deadlock directed recovery while its health publication is still pending', async () => {
    const { runtime, onReinjected } = createFixture();
    let finishPublication: (() => void) | undefined;
    onReinjected.mockImplementationOnce(
      () =>
        new Promise<undefined>(resolve => {
          finishPublication = () => resolve(undefined);
        })
    );

    await expect(
      runtime.reinjectTab({
        tabId: 5,
        requiredFile: 'content-fichamedico.js',
      })
    ).resolves.toEqual({ injected: true });
    expect(onReinjected).toHaveBeenCalledWith(1);
    finishPublication?.();
  });

  it('rejects directed recovery when the requested relay is not an exact manifest entry', async () => {
    const { runtime, executeScript } = createFixture();

    await expect(
      runtime.reinjectTab({
        tabId: 5,
        requiredFile: 'unknown-relay.js',
      })
    ).resolves.toEqual({ injected: false, reason: 'manifest_entry_missing' });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('does not inject a Ficha relay after the tab navigated to another declared host', async () => {
    const { runtime, executeScript } = createFixture();

    await expect(
      runtime.reinjectTab({
        tabId: 8,
        requiredFile: 'content-fichamedico.js',
      })
    ).resolves.toEqual({ injected: false, reason: 'tab_url_mismatch' });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('sin permiso de scripting no arranca', () => {
    const { runtime, chromeApi } = createFixture();
    delete (chromeApi as { scripting?: unknown }).scripting;
    expect(runtime.start()).toBe(false);
  });
});
