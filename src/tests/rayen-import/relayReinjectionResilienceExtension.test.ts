// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { MANIFEST, createFixture } from './relayReinjectionHarness';

describe('relay reinjection resilience (extension)', () => {
  it('restores HHR before waiting for a slow Ficha tab on worker startup', async () => {
    const { runtime, chromeApi, executeScript } = createFixture();
    const originalQuery = chromeApi.tabs.query.getMockImplementation();
    let releaseFicha: (() => void) | undefined;
    chromeApi.tabs.query.mockImplementation(async options => {
      if (options.url.includes('https://fichamedico.rayensalud.cl/*')) {
        await new Promise<void>(resolve => {
          releaseFicha = resolve;
        });
      }
      return originalQuery!(options);
    });

    const recovery = runtime.reinjectRelays();
    await vi.waitFor(() =>
      expect(
        executeScript.mock.calls.some(
          ([injection]) => injection.target.tabId === 8 && Boolean(injection.files)
        )
      ).toBe(true)
    );
    expect(chromeApi.tabs.query.mock.calls[0][0].url).toContain('http://localhost:3001/*');
    releaseFicha?.();
    await recovery;
  });

  it('repairs a missing Camas receiver during a health check without touching healthy tabs', async () => {
    const { runtime, chromeApi, executeScript, onReinjected } = createFixture();
    let missing = true;
    chromeApi.tabs.sendMessage.mockImplementation(
      async (tabId: number, message?: { type?: string }) => {
        if (tabId === 6 && message?.type === 'RAYEN_EXTENSION_RELAY_PING' && missing) {
          missing = false;
          throw new Error('Receiving end does not exist');
        }
        if (message?.type === 'RAYEN_EXTENSION_INDICATOR_PING') return { indicatorReady: true };
        return { relayReady: tabId === 6 ? 'gestioncamas' : 'hhr' };
      }
    );

    await expect(runtime.repairMissingRelay('content-gestioncamas.js')).resolves.toEqual({
      injectedTabs: 1,
      failedTabs: 0,
      complete: true,
    });
    expect(chromeApi.tabs.query).toHaveBeenCalledTimes(1);
    expect(executeScript.mock.calls.every(([injection]) => injection.target.tabId === 6)).toBe(
      true
    );
    expect(onReinjected).toHaveBeenCalledWith(1);
  });

  it('reinyecta una interfaz Ficha anterior aunque el relé y su ping aún respondan', async () => {
    const { runtime, chromeApi, executeScript } = createFixture();
    let uiBuildVersion = '0.48.32';
    chromeApi.tabs.sendMessage.mockImplementation(
      async (tabId: number, message?: { type?: string }) => {
        if (message?.type === 'RAYEN_EXTENSION_FICHA_UI_PING')
          return { uiReady: true, uiBuildVersion };
        if (message?.type === 'RAYEN_EXTENSION_MAIN_PING') return { mainReady: true };
        return { relayReady: tabId === 5 ? 'fichamedico' : 'hhr' };
      }
    );
    executeScript.mockImplementation(async injection => {
      if (injection.files?.includes('content-prescription-print.js'))
        uiBuildVersion = MANIFEST.version;
      return undefined;
    });

    await expect(runtime.repairActivatedTab(5)).resolves.toEqual({ injected: true });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 5, allFrames: false },
      files: MANIFEST.content_scripts[6].js,
    });
  });
});
