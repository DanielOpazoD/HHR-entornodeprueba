// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { MANIFEST, createFixture } from './relayReinjectionHarness';

describe('Ficha MAIN reader health after an idle worker wake', () => {
  it('repairs the inner reader even while its outer relay and UI still answer', async () => {
    const { runtime, chromeApi, executeScript } = createFixture();
    let mainReady = false;
    chromeApi.tabs.sendMessage.mockImplementation(
      async (tabId: number, message?: { type?: string }) => {
        if (message?.type === 'RAYEN_EXTENSION_MAIN_PING') return { mainReady };
        if (message?.type === 'RAYEN_EXTENSION_FICHA_UI_PING')
          return { uiReady: true, uiBuildVersion: MANIFEST.version };
        if (message?.type === 'RAYEN_EXTENSION_INDICATOR_PING') return { indicatorReady: true };
        return { relayReady: tabId === 5 ? 'fichamedico' : tabId === 6 ? 'gestioncamas' : 'hhr' };
      }
    );
    executeScript.mockImplementation(async injection => {
      if (injection.world === 'MAIN' && injection.target.tabId === 5) mainReady = true;
      return undefined;
    });

    await expect(runtime.repairActivatedTab(5)).resolves.toEqual({ injected: true });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 5, allFrames: false },
      world: 'MAIN',
      files: MANIFEST.content_scripts[0].js,
    });
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(5, {
      type: 'RAYEN_EXTENSION_MAIN_PING',
    });
  });

  it('leaves an incompatible retained reader for the safe new-tab repair action', async () => {
    const { runtime, chromeApi, executeScript } = createFixture();
    chromeApi.tabs.sendMessage.mockImplementation(
      async (tabId: number, message?: { type?: string }) => {
        if (message?.type === 'RAYEN_EXTENSION_MAIN_PING') {
          return { mainReady: false, reason: 'incompatible_reader' };
        }
        if (message?.type === 'RAYEN_EXTENSION_FICHA_UI_PING')
          return { uiReady: true, uiBuildVersion: MANIFEST.version };
        return { relayReady: tabId === 5 ? 'fichamedico' : 'hhr' };
      }
    );

    await expect(runtime.repairActivatedTab(5)).resolves.toEqual({
      injected: false,
      healthy: false,
      reason: 'incompatible_reader',
    });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('does not repeatedly reinject when a retained reader cannot prove compatibility', async () => {
    const { runtime, chromeApi, executeScript } = createFixture();
    chromeApi.tabs.sendMessage.mockImplementation(
      async (tabId: number, message?: { type?: string }) => {
        if (message?.type === 'RAYEN_EXTENSION_MAIN_PING') {
          return { mainReady: false, reason: 'unverified_reader' };
        }
        if (message?.type === 'RAYEN_EXTENSION_FICHA_UI_PING')
          return { uiReady: true, uiBuildVersion: MANIFEST.version };
        return { relayReady: tabId === 5 ? 'fichamedico' : 'hhr' };
      }
    );

    await expect(runtime.repairActivatedTab(5)).resolves.toEqual({
      injected: false,
      healthy: false,
      reason: 'unverified_reader',
    });
    await runtime.repairActivatedTab(5);
    expect(executeScript).not.toHaveBeenCalled();
  });
});
