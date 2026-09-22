// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

/**
 * HHR ↔ extensión: cancelar una captura en curso.
 *
 * Antes, cancelar en HHR sólo borraba el id local: la extensión seguía capturando ambas fuentes
 * hasta 75 s y la respuesta tardía volvía como error. Ahora HHR publica la cancelación, el relay
 * la reenvía al service worker y silencia cualquier respuesta marcada como cancelada.
 */

const relaySource = readFileSync(path.resolve('extension/content-hhr-sync-bundle.js'), 'utf8');
const ORIGIN = 'http://localhost:3001';

type PageMessage = { source: unknown; origin: string; data: Record<string, unknown> };

const createHarness = (respond: (message: Record<string, unknown>) => Promise<unknown>) => {
  const listeners: Array<(event: PageMessage) => void> = [];
  const postMessage = vi.fn();
  const sendMessage = vi.fn((message: Record<string, unknown>) => respond(message));
  const windowObject = {
    location: { origin: ORIGIN },
    addEventListener: vi.fn((type: string, listener: (event: PageMessage) => void) => {
      if (type === 'message') listeners.push(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: (event: PageMessage) => void) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    }),
    postMessage,
  };
  const context = vm.createContext({
    window: windowObject,
    chrome: { runtime: { id: 'current-extension', sendMessage } },
    console,
    HhrRayenMessageContract: {
      types: {
        SYNC_BUNDLE_REQUEST: 'RAYEN_SYNC_BUNDLE_REQUEST',
        SYNC_BUNDLE_CANCEL: 'RAYEN_SYNC_BUNDLE_CANCEL',
      },
    },
  });
  const inject = () =>
    vm.runInContext(relaySource, context, { filename: 'content-hhr-sync-bundle.js' });
  inject();
  const dispatch = (
    data: Record<string, unknown>,
    origin = ORIGIN,
    source: unknown = windowObject
  ) => listeners.forEach(listener => listener({ source, origin, data }));
  return { dispatch, inject, postMessage, sendMessage };
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('content-hhr-sync-bundle relay · cancellation', () => {
  it('replaces its page listener when the same ISOLATED world is reinjected', async () => {
    const { dispatch, inject, sendMessage } = createHarness(async () => ({ cancelled: true }));
    inject();

    dispatch({ type: 'HHR_RAYEN_REQUEST_SYNC_BUNDLE', requestId: 'only-once' });
    await flush();

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('forwards a page cancellation to the service worker with the request id', async () => {
    const { dispatch, sendMessage } = createHarness(async () => ({ ok: true }));

    dispatch({ type: 'HHR_RAYEN_CANCEL_SYNC_BUNDLE', requestId: 'rayen-sync-1' });
    await flush();

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'RAYEN_SYNC_BUNDLE_CANCEL',
      requestId: 'rayen-sync-1',
    });
  });

  it('ignores cancellations without id or from another origin', async () => {
    const { dispatch, sendMessage } = createHarness(async () => ({ ok: true }));

    dispatch({ type: 'HHR_RAYEN_CANCEL_SYNC_BUNDLE' });
    dispatch({ type: 'HHR_RAYEN_CANCEL_SYNC_BUNDLE', requestId: 'x' }, 'https://evil.example');
    await flush();

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('silences a capture the worker reports as cancelled instead of posting a late error', async () => {
    const { dispatch, postMessage } = createHarness(async () => ({
      error: 'Sincronización cancelada desde HHR.',
      cancelled: true,
    }));

    dispatch({
      type: 'HHR_RAYEN_REQUEST_SYNC_BUNDLE',
      requestId: 'rayen-sync-2',
      dateStart: '2026-09-10',
      dateEnd: '2026-09-11',
    });
    await flush();

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('still surfaces a genuine capture failure as an import error', async () => {
    const { dispatch, postMessage } = createHarness(async () => ({
      error: 'Una fuente se desconectó.',
    }));

    dispatch({
      type: 'HHR_RAYEN_REQUEST_SYNC_BUNDLE',
      requestId: 'rayen-sync-3',
      dateStart: '2026-09-10',
      dateEnd: '2026-09-11',
    });
    await flush();

    expect(postMessage).toHaveBeenCalledWith(
      {
        type: 'HHR_RAYEN_IMPORT_ERROR',
        requestId: 'rayen-sync-3',
        error: 'Una fuente se desconectó.',
      },
      ORIGIN
    );
  });

  it.each(['Fallo de transporte verificable.', 'Extension context invalidated.'])(
    'surfaces a downstream rejection while the relay remains alive: %s',
    async message => {
      const { dispatch, postMessage } = createHarness(async () => {
        throw new Error(message);
      });

      dispatch({
        type: 'HHR_RAYEN_REQUEST_SYNC_BUNDLE',
        requestId: 'rayen-sync-network-error',
        dateStart: '2026-09-10',
        dateEnd: '2026-09-11',
      });
      await flush();

      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HHR_RAYEN_IMPORT_ERROR',
          requestId: 'rayen-sync-network-error',
          error: `Error: ${message}`,
        }),
        ORIGIN
      );
    }
  );

  it('lets only the live relay answer when an invalidated context shares the same page', async () => {
    const listeners: Array<(event: PageMessage) => void> = [];
    const postMessage = vi.fn();
    const windowObject = {
      location: { origin: ORIGIN },
      addEventListener: vi.fn((type: string, listener: (event: PageMessage) => void) => {
        if (type === 'message') listeners.push(listener);
      }),
      postMessage,
    };
    let resolveOld!: (value: unknown) => void;
    const oldRuntime: { id?: string; sendMessage: ReturnType<typeof vi.fn> } = {
      id: 'old-extension',
      sendMessage: vi.fn(() => new Promise(resolve => (resolveOld = resolve))),
    };
    const install = (runtime: typeof oldRuntime) =>
      vm.runInContext(
        relaySource,
        vm.createContext({
          window: windowObject,
          chrome: { runtime },
          console,
          HhrRayenMessageContract: {
            types: {
              SYNC_BUNDLE_REQUEST: 'RAYEN_SYNC_BUNDLE_REQUEST',
              SYNC_BUNDLE_CANCEL: 'RAYEN_SYNC_BUNDLE_CANCEL',
            },
          },
        }),
        { filename: 'content-hhr-sync-bundle.js' }
      );
    const dispatch = (requestId: string) =>
      listeners.forEach(listener =>
        listener({
          source: windowObject,
          origin: ORIGIN,
          data: {
            type: 'HHR_RAYEN_REQUEST_SYNC_BUNDLE',
            requestId,
            dateStart: '2026-09-10',
            dateEnd: '2026-09-11',
          },
        })
      );

    install(oldRuntime);
    dispatch('old-in-flight');
    oldRuntime.id = undefined;
    const currentRuntime = {
      id: 'current-extension',
      sendMessage: vi.fn(async () => ({ error: 'Respuesta vigente.' })),
    };
    install(currentRuntime);
    dispatch('current-request');
    resolveOld({ error: 'Extension context invalidated.' });
    await flush();

    expect(oldRuntime.sendMessage).toHaveBeenCalledTimes(1);
    expect(currentRuntime.sendMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'current-request', error: 'Respuesta vigente.' }),
      ORIGIN
    );
  });
});
