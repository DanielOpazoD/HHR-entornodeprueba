// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { runtimeModule, MANIFEST, createFixture } from './relayReinjectionHarness';

const fileInjections = (mock: ReturnType<typeof createFixture>['executeScript']) =>
  mock.mock.calls.filter(([injection]) => Boolean(injection.files));

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
      target: { tabId: 5, allFrames: false },
      files: MANIFEST.content_scripts[6].js,
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 8, allFrames: false },
      files: MANIFEST.content_scripts[4].js,
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 9, allFrames: true },
      files: ['lab-result-parser.js', 'lab-viewer.js', 'syslab-bridge.js'],
    });
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      9,
      { type: 'RAYEN_SYSLAB_STATUS' },
      { frameId: 0 }
    );
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
    await expect(runtime.ensureReinjected()).resolves.toEqual({
      injectedTabs: 0,
      failedTabs: 0,
      complete: true,
      skipped: true,
    });
    expect(fileInjections(executeScript)).toHaveLength(0);
  });

  it('repara un receptor HHR invalidado aunque Chrome conserve la marca de la misma versión', async () => {
    const { runtime, chromeApi, executeScript, sessionState, onReinjected } = createFixture();
    sessionState[runtimeModule.STORAGE_KEY] = MANIFEST.version;
    let hhrPingCount = 0;
    chromeApi.tabs.sendMessage.mockImplementation(
      async (tabId: number, message?: { type?: string }) => {
        if (message?.type === 'RAYEN_SYSLAB_STATUS') return { ok: true, bridgeId: 'syslab-test' };
        if (message?.type === 'RAYEN_EXTENSION_INDICATOR_PING') return { indicatorReady: true };
        if (message?.type === 'RAYEN_EXTENSION_FICHA_UI_PING') return { uiReady: true };
        if (message?.type === 'RAYEN_EXTENSION_MAIN_PING') return { mainReady: true };
        if (tabId === 8 && ++hhrPingCount === 1) throw new Error('Receiving end does not exist');
        return { relayReady: tabId === 5 ? 'fichamedico' : tabId === 6 ? 'gestioncamas' : 'hhr' };
      }
    );

    await expect(runtime.ensureReinjected()).resolves.toMatchObject({
      injectedTabs: 1,
      complete: true,
      skipped: false,
    });
    expect(fileInjections(executeScript)).toHaveLength(1);
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 8, allFrames: false },
      files: MANIFEST.content_scripts[4].js,
    });
    expect(onReinjected).toHaveBeenCalledWith(1);
  });

  it('repara Syslab al conservar Chrome la marca de versión pero perder su receptor', async () => {
    const { runtime, chromeApi, executeScript, sessionState } = createFixture();
    sessionState[runtimeModule.STORAGE_KEY] = MANIFEST.version;
    let syslabPings = 0;
    chromeApi.tabs.sendMessage.mockImplementation(
      async (tabId: number, message?: { type?: string }) => {
        if (message?.type === 'RAYEN_SYSLAB_STATUS') {
          if (++syslabPings === 1) throw new Error('Receiving end does not exist');
          return { ok: true, bridgeId: 'syslab-test' };
        }
        if (message?.type === 'RAYEN_EXTENSION_INDICATOR_PING') return { indicatorReady: true };
        if (message?.type === 'RAYEN_EXTENSION_FICHA_UI_PING') return { uiReady: true };
        if (message?.type === 'RAYEN_EXTENSION_MAIN_PING') return { mainReady: true };
        return { relayReady: tabId === 5 ? 'fichamedico' : tabId === 6 ? 'gestioncamas' : 'hhr' };
      }
    );
    await expect(runtime.ensureReinjected()).resolves.toMatchObject({
      injectedTabs: 1,
      complete: true,
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 9, allFrames: true },
      files: MANIFEST.content_scripts[5].js,
    });
  });

  it('no acepta la respuesta de un iframe sano si otro marco Syslab perdió su receptor', async () => {
    const { runtime, chromeApi, executeScript, sessionState } = createFixture();
    sessionState[runtimeModule.STORAGE_KEY] = MANIFEST.version;
    executeScript.mockImplementation(async injection =>
      injection.func
        ? [
            { frameId: 0, result: 'http://10.4.69.90/syslab/index.php' },
            { frameId: 7, result: 'http://10.4.69.90/syslab/parbusqueRut.php' },
          ]
        : undefined
    );
    let secondFramePings = 0;
    chromeApi.tabs.sendMessage.mockImplementation(
      async (tabId: number, message?: { type?: string }, options?: { frameId?: number }) => {
        if (message?.type === 'RAYEN_SYSLAB_STATUS') {
          if (options?.frameId === 7 && ++secondFramePings === 1)
            throw new Error('Receiving end does not exist');
          return { ok: true, bridgeId: `frame-${options?.frameId}` };
        }
        if (message?.type === 'RAYEN_EXTENSION_INDICATOR_PING') return { indicatorReady: true };
        if (message?.type === 'RAYEN_EXTENSION_FICHA_UI_PING') return { uiReady: true };
        if (message?.type === 'RAYEN_EXTENSION_MAIN_PING') return { mainReady: true };
        return { relayReady: tabId === 5 ? 'fichamedico' : tabId === 6 ? 'gestioncamas' : 'hhr' };
      }
    );

    await expect(runtime.ensureReinjected()).resolves.toMatchObject({
      injectedTabs: 1,
      complete: true,
    });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 9, allFrames: true },
      files: MANIFEST.content_scripts[5].js,
    });
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      9,
      { type: 'RAYEN_SYSLAB_STATUS' },
      { frameId: 7 }
    );
  });

  it('no pierde onInstalled si llega mientras la comprobación de arranque está pendiente', async () => {
    const { runtime, chromeApi, executeScript, installedListeners, sessionState } = createFixture();
    sessionState[runtimeModule.STORAGE_KEY] = MANIFEST.version;
    let releaseGet: ((value: Record<string, unknown>) => void) | undefined;
    chromeApi.storage.session.get.mockImplementationOnce(
      (_key: string) =>
        new Promise(resolve => {
          releaseGet = resolve;
        })
    );

    expect(runtime.start()).toBe(true);
    installedListeners.forEach(listener => listener());
    releaseGet?.({ [runtimeModule.STORAGE_KEY]: MANIFEST.version });
    await vi.waitFor(() => expect(executeScript).toHaveBeenCalled());
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 8, allFrames: false },
      files: MANIFEST.content_scripts[4].js,
    });
  });

  it('reinyecta la interfaz de Camas si el relé responde pero el indicador quedó huérfano', async () => {
    const { runtime, chromeApi, executeScript, sessionState } = createFixture();
    sessionState[runtimeModule.STORAGE_KEY] = MANIFEST.version;
    let indicatorPings = 0;
    chromeApi.tabs.sendMessage.mockImplementation(
      async (tabId: number, message?: { type?: string }) =>
        message?.type === 'RAYEN_EXTENSION_INDICATOR_PING'
          ? { indicatorReady: ++indicatorPings > 1 }
          : { relayReady: tabId === 5 ? 'fichamedico' : tabId === 6 ? 'gestioncamas' : 'hhr' }
    );

    await expect(runtime.ensureReinjected()).resolves.toMatchObject({ injectedTabs: 1 });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 6, allFrames: false },
      files: MANIFEST.content_scripts[3].js,
    });
  });

  it('reinyecta la interfaz de Ficha si el relé responde pero el panel quedó huérfano', async () => {
    const { runtime, chromeApi, executeScript, sessionState } = createFixture();
    sessionState[runtimeModule.STORAGE_KEY] = MANIFEST.version;
    let uiPings = 0;
    chromeApi.tabs.sendMessage.mockImplementation(
      async (tabId: number, message?: { type?: string }) =>
        message?.type === 'RAYEN_EXTENSION_FICHA_UI_PING'
          ? { uiReady: ++uiPings > 1 }
          : message?.type === 'RAYEN_EXTENSION_MAIN_PING'
            ? { mainReady: true }
            : message?.type === 'RAYEN_EXTENSION_INDICATOR_PING'
              ? { indicatorReady: true }
              : { relayReady: tabId === 5 ? 'fichamedico' : tabId === 6 ? 'gestioncamas' : 'hhr' }
    );

    await expect(runtime.ensureReinjected()).resolves.toMatchObject({ injectedTabs: 1 });
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 5, allFrames: false },
      files: MANIFEST.content_scripts[6].js,
    });
  });

  it('con dos pestañas de Ficha repara sólo la que perdió su receptor', async () => {
    const { runtime, chromeApi, executeScript, sessionState } = createFixture();
    sessionState[runtimeModule.STORAGE_KEY] = MANIFEST.version;
    chromeApi.tabs.query.mockImplementation(async ({ url }: { url: string[] }) =>
      url.includes('https://fichamedico.rayensalud.cl/*')
        ? [
            { id: 5, url: 'https://fichamedico.rayensalud.cl/dashboard' },
            { id: 7, url: 'https://fichamedico.rayensalud.cl/dashboard' },
          ]
        : []
    );
    chromeApi.tabs.get.mockImplementation(async (tabId: number) => ({
      id: tabId,
      url: 'https://fichamedico.rayensalud.cl/dashboard',
    }));
    let orphanPings = 0;
    chromeApi.tabs.sendMessage.mockImplementation(
      async (tabId: number, message?: { type?: string }) =>
        message?.type === 'RAYEN_EXTENSION_FICHA_UI_PING'
          ? { uiReady: tabId !== 7 || ++orphanPings > 1 }
          : message?.type === 'RAYEN_EXTENSION_MAIN_PING'
            ? { mainReady: true }
            : { relayReady: 'fichamedico' }
    );

    await expect(runtime.ensureReinjected()).resolves.toMatchObject({
      injectedTabs: 1,
      complete: true,
    });
    expect(executeScript.mock.calls.every(([injection]) => injection.target.tabId === 7)).toBe(
      true
    );
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 7, allFrames: false },
      files: MANIFEST.content_scripts[6].js,
    });
  });

  it('repara sólo la pestaña activada cuando Ficha perdió su panel tras reactivar la extensión', async () => {
    const { runtime, chromeApi, executeScript, onReinjected, activatedListeners, sessionState } =
      createFixture();
    sessionState[runtimeModule.STORAGE_KEY] = MANIFEST.version;
    expect(runtime.start()).toBe(true);
    await runtime.ensureReinjected();
    expect(fileInjections(executeScript)).toHaveLength(0);
    executeScript.mockClear();
    onReinjected.mockClear();
    let uiReady = false;
    chromeApi.tabs.sendMessage.mockImplementation(
      async (tabId: number, message?: { type?: string }) => {
        if (message?.type === 'RAYEN_EXTENSION_FICHA_UI_PING') return { uiReady };
        if (message?.type === 'RAYEN_EXTENSION_MAIN_PING') return { mainReady: true };
        if (message?.type === 'RAYEN_EXTENSION_INDICATOR_PING') return { indicatorReady: true };
        return { relayReady: tabId === 5 ? 'fichamedico' : tabId === 6 ? 'gestioncamas' : 'hhr' };
      }
    );
    executeScript.mockImplementation(async injection => {
      if (injection.files?.includes('content-prescription-print.js')) uiReady = true;
      return undefined;
    });

    activatedListeners.forEach(listener => listener({ tabId: 5 }));
    await vi.waitFor(() => expect(onReinjected).toHaveBeenCalledWith(1));
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 5, allFrames: false },
      files: MANIFEST.content_scripts[6].js,
    });
    executeScript.mockClear();
    await runtime.repairActivatedTab(5);
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
        if (message?.type === 'RAYEN_EXTENSION_FICHA_UI_PING') return { uiReady: true };
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

  it('repairs one exact relay after the session marker and verifies its receiver', async () => {
    const { runtime, executeScript, sessionState, chromeApi } = createFixture();
    sessionState[runtimeModule.STORAGE_KEY] = MANIFEST.version;

    await expect(runtime.ensureReinjected()).resolves.toEqual({
      injectedTabs: 0,
      failedTabs: 0,
      complete: true,
      skipped: true,
    });
    await expect(
      runtime.reinjectTab({ tabId: 5, requiredFile: 'content-fichamedico.js' })
    ).resolves.toEqual({ injected: true });

    expect(fileInjections(executeScript)).toHaveLength(3);
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(5, {
      type: 'RAYEN_EXTENSION_RELAY_PING',
    });
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(5, {
      type: 'RAYEN_EXTENSION_FICHA_UI_PING',
    });
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(5, {
      type: 'RAYEN_EXTENSION_MAIN_PING',
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

  it('no declara reparado Camas si su indicador sigue sin responder tras inyectar', async () => {
    const { runtime, chromeApi } = createFixture();
    chromeApi.tabs.sendMessage.mockImplementation(
      async (tabId: number, message?: { type?: string }) =>
        message?.type === 'RAYEN_EXTENSION_INDICATOR_PING'
          ? { indicatorReady: false }
          : { relayReady: tabId === 6 ? 'gestioncamas' : 'hhr' }
    );
    await expect(
      runtime.reinjectTab({ tabId: 6, requiredFile: 'content-gestioncamas.js' })
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
      [5_000, 'La interfaz de Ficha Médico excedió el tiempo esperado.'],
      [5_000, 'El relé no confirmó su receptor.'],
      [5_000, 'La interfaz de Ficha Médico no confirmó su conexión.'],
      [5_000, 'El lector interno de Ficha Médico no confirmó su conexión.'],
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
