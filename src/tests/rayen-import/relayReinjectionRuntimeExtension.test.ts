// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import '../../../extension/relay-reinjection-runtime.js';

type ReinjectionRuntime = {
  create: (deps: Record<string, unknown>) => {
    start: () => boolean;
    reinjectRelays: () => Promise<{ injectedTabs: number }>;
  };
};

const runtimeModule = (globalThis as unknown as { HhrRelayReinjectionRuntime: ReinjectionRuntime })
  .HhrRelayReinjectionRuntime;

const MANIFEST = {
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
  const chromeApi = {
    runtime: {
      getManifest: () => MANIFEST,
      onInstalled: {
        addListener: vi.fn((listener: () => void) => installedListeners.push(listener)),
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
  return { runtime, chromeApi, executeScript, onReinjected, installedListeners };
};

describe('relay reinjection runtime (extension)', () => {
  it('re-inyecta solo los relés ISOLATED del manifest y avisa al terminar', async () => {
    const { runtime, executeScript, onReinjected } = createFixture();

    await expect(runtime.reinjectRelays()).resolves.toEqual({ injectedTabs: 3 });

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

    await expect(runtime.reinjectRelays()).resolves.toEqual({ injectedTabs: 0 });
    expect(onReinjected).not.toHaveBeenCalled();
  });

  it('se registra en onInstalled y ejecuta la re-inyección al instalar', async () => {
    const { runtime, executeScript, installedListeners } = createFixture();

    expect(runtime.start()).toBe(true);
    installedListeners.forEach(listener => listener());
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalled());
  });

  it('sin permiso de scripting no arranca', () => {
    const { runtime, chromeApi } = createFixture();
    delete (chromeApi as { scripting?: unknown }).scripting;
    expect(runtime.start()).toBe(false);
  });
});
