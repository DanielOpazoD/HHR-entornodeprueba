// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { runtimeModule, MANIFEST, createFixture } from './relayReinjectionHarness';

describe('restored clinical tabs (extension)', () => {
  it('registra onStartup y no duplica la inspección mientras arranca Chrome', async () => {
    const { runtime, chromeApi, startupListeners, sessionState } = createFixture();
    sessionState[runtimeModule.STORAGE_KEY] = MANIFEST.version;
    let release!: (value: Record<string, unknown>) => void;
    chromeApi.storage.session.get.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = resolve;
        })
    );

    expect(runtime.start()).toBe(true);
    expect(startupListeners).toHaveLength(1);
    startupListeners[0]();
    release({ [runtimeModule.STORAGE_KEY]: MANIFEST.version });
    await vi.waitFor(() => expect(chromeApi.storage.session.get).toHaveBeenCalledTimes(1));
  });

  it('repara una pestaña restaurada después del primer barrido y comparte la activación', async () => {
    const {
      runtime,
      chromeApi,
      executeScript,
      onReinjected,
      updatedListeners,
      activatedListeners,
      sessionState,
    } = createFixture();
    sessionState[runtimeModule.STORAGE_KEY] = MANIFEST.version;
    chromeApi.tabs.query.mockResolvedValue([]);
    expect(runtime.start()).toBe(true);
    await runtime.ensureReinjected();
    executeScript.mockClear();
    let receiverReady = false;
    chromeApi.tabs.sendMessage.mockImplementation(
      async (tabId: number, message?: { type?: string }) => {
        if (message?.type === 'RAYEN_EXTENSION_INDICATOR_PING') return { indicatorReady: true };
        if (message?.type === 'RAYEN_EXTENSION_FICHA_UI_PING')
          return { uiReady: true, uiBuildVersion: MANIFEST.version };
        if (message?.type === 'RAYEN_EXTENSION_MAIN_PING') return { mainReady: true };
        if (tabId === 6 && !receiverReady) throw new Error('Receiving end does not exist');
        return { relayReady: tabId === 6 ? 'gestioncamas' : 'hhr' };
      }
    );
    executeScript.mockImplementation(async () => {
      receiverReady = true;
      return undefined;
    });

    updatedListeners[0](
      6,
      { status: 'loading' },
      { url: 'https://hospitalizado.rayensalud.cl/#/bed' }
    );
    updatedListeners[0](9, { status: 'complete' }, { url: 'http://10.4.69.90/syslab/index.php' });
    expect(executeScript).not.toHaveBeenCalled();
    updatedListeners[0](
      6,
      { status: 'complete' },
      { url: 'https://hospitalizado.rayensalud.cl/#/bed' }
    );
    activatedListeners[0]({ tabId: 6 });
    await vi.waitFor(() => expect(onReinjected).toHaveBeenCalledWith(1));
    expect(executeScript).toHaveBeenCalledTimes(2);
    expect(onReinjected).toHaveBeenCalledTimes(1);
    expect(chromeApi.tabs.get).toHaveBeenCalledWith(6);
  });

  it('comprueba de nuevo una pestaña HHR tras reanudarla sin reinyectar si sigue sana', async () => {
    const {
      runtime,
      chromeApi,
      executeScript,
      updatedListeners,
      activatedListeners,
      sessionState,
    } = createFixture();
    sessionState[runtimeModule.STORAGE_KEY] = MANIFEST.version;
    expect(runtime.start()).toBe(true);
    await runtime.ensureReinjected();
    executeScript.mockClear();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      updatedListeners[0](8, { status: 'complete' }, { url: 'http://localhost:3001/census' });
      activatedListeners[0]({ tabId: 8 });
      await vi.waitFor(() => expect(chromeApi.tabs.get).toHaveBeenCalledTimes(attempt + 1));
    }
    expect(executeScript).not.toHaveBeenCalled();
  });
});
