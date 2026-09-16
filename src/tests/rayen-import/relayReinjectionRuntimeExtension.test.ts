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
      js: ['message-contract.js', 'content-fichamedico.js'],
    },
    { matches: ['http://localhost:3001/*'], js: ['message-contract.js', 'content-hhr.js'] },
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
        url.includes('https://fichamedico.rayensalud.cl/*') ? [{ id: 5 }] : [{ id: 8 }]
      ),
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

    // Nunca los scripts de mundo MAIN (sobreviven al reload y guardan estado).
    const injectedFiles = executeScript.mock.calls.flatMap(call => call[0].files);
    expect(injectedFiles).not.toContain('inject-fichamedico.js');
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 5, allFrames: false },
      files: ['message-contract.js', 'content-fichamedico.js'],
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 8, allFrames: true },
      files: ['syslab-bridge.js'],
    });
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

  it('sin permiso de scripting no arranca', () => {
    const { runtime, chromeApi } = createFixture();
    delete (chromeApi as { scripting?: unknown }).scripting;
    expect(runtime.start()).toBe(false);
  });
});
