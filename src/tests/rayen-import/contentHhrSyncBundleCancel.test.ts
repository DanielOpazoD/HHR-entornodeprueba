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

// Await the actual relay promise chain, including its final catch handler.
// Negative assertions must run after completion, not after an arbitrary timer.
const trackResponses = () => {
  const pending: Promise<unknown>[] = [];
  type ResponseChain = {
    then: (fulfilled: (value: unknown) => unknown) => ResponseChain;
    catch: (rejected: (reason: unknown) => unknown) => ResponseChain;
  };
  const track = (promise: Promise<unknown>): ResponseChain => {
    pending.push(promise);
    return {
      then: fulfilled => track(promise.then(fulfilled)),
      catch: rejected => track(promise.catch(rejected)),
    };
  };
  const settle = async () => {
    let completed = 0;
    while (completed < pending.length) {
      const current = pending.slice(completed);
      completed = pending.length;
      await Promise.allSettled(current);
    }
  };
  return { track, settle };
};

const createHarness = (respond: (message: Record<string, unknown>) => Promise<unknown>) => {
  const listeners: Array<(event: PageMessage) => void> = [];
  const postMessage = vi.fn();
  const responses = trackResponses();
  const sendMessage = vi.fn((message: Record<string, unknown>) =>
    responses.track(respond(message))
  );
  const windowObject = {
    location: { origin: ORIGIN },
    addEventListener: vi.fn((type: string, listener: (event: PageMessage) => void) => {
      if (type === 'message') listeners.push(listener);
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
  vm.runInContext(relaySource, context, { filename: 'content-hhr-sync-bundle.js' });
  const dispatch = (
    data: Record<string, unknown>,
    origin = ORIGIN,
    source: unknown = windowObject
  ) => listeners.forEach(listener => listener({ source, origin, data }));
  return { dispatch, postMessage, sendMessage, settle: responses.settle };
};

describe('content-hhr-sync-bundle relay · cancellation', () => {
  it('forwards a page cancellation to the service worker with the request id', async () => {
    const { dispatch, sendMessage, settle } = createHarness(async () => ({ ok: true }));

    dispatch({ type: 'HHR_RAYEN_CANCEL_SYNC_BUNDLE', requestId: 'rayen-sync-1' });
    await settle();

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'RAYEN_SYNC_BUNDLE_CANCEL',
      requestId: 'rayen-sync-1',
    });
  });

  it('ignores cancellations without id or from another origin', async () => {
    const { dispatch, sendMessage, settle } = createHarness(async () => ({ ok: true }));

    dispatch({ type: 'HHR_RAYEN_CANCEL_SYNC_BUNDLE' });
    dispatch({ type: 'HHR_RAYEN_CANCEL_SYNC_BUNDLE', requestId: 'x' }, 'https://evil.example');
    await settle();

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('silences a capture the worker reports as cancelled instead of posting a late error', async () => {
    const { dispatch, postMessage, settle } = createHarness(async () => ({
      error: 'Sincronización cancelada desde HHR.',
      cancelled: true,
    }));

    dispatch({
      type: 'HHR_RAYEN_REQUEST_SYNC_BUNDLE',
      requestId: 'rayen-sync-2',
      dateStart: '2026-09-10',
      dateEnd: '2026-09-11',
    });
    await settle();

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('waits for a genuinely late cancelled response before asserting silence', async () => {
    let finish!: (value: unknown) => void;
    const { dispatch, postMessage, sendMessage, settle } = createHarness(message =>
      message.type === 'RAYEN_SYNC_BUNDLE_CANCEL'
        ? Promise.resolve({ ok: true })
        : new Promise(resolve => {
            finish = resolve;
          })
    );
    dispatch({ type: 'HHR_RAYEN_REQUEST_SYNC_BUNDLE', requestId: 'delayed' });
    dispatch({ type: 'HHR_RAYEN_CANCEL_SYNC_BUNDLE', requestId: 'delayed' });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    finish({ cancelled: true, error: 'Respuesta tardía.' });
    await settle();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('still surfaces a genuine capture failure as an import error', async () => {
    const { dispatch, postMessage, settle } = createHarness(async () => ({
      error: 'Una fuente se desconectó.',
    }));

    dispatch({
      type: 'HHR_RAYEN_REQUEST_SYNC_BUNDLE',
      requestId: 'rayen-sync-3',
      dateStart: '2026-09-10',
      dateEnd: '2026-09-11',
    });
    await settle();

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
      const { dispatch, postMessage, settle } = createHarness(async () => {
        throw new Error(message);
      });

      dispatch({
        type: 'HHR_RAYEN_REQUEST_SYNC_BUNDLE',
        requestId: 'rayen-sync-network-error',
        dateStart: '2026-09-10',
        dateEnd: '2026-09-11',
      });
      await settle();

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
    const responses = trackResponses();
    const settle = responses.settle;
    let resolveOld!: (value: unknown) => void;
    const oldRuntime: { id?: string; sendMessage: ReturnType<typeof vi.fn> } = {
      id: 'old-extension',
      sendMessage: vi.fn(() => responses.track(new Promise(resolve => (resolveOld = resolve)))),
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
      sendMessage: vi.fn(() => responses.track(Promise.resolve({ error: 'Respuesta vigente.' }))),
    };
    install(currentRuntime);
    dispatch('current-request');
    resolveOld({ error: 'Extension context invalidated.' });
    await settle();

    expect(oldRuntime.sendMessage).toHaveBeenCalledTimes(1);
    expect(currentRuntime.sendMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'current-request', error: 'Respuesta vigente.' }),
      ORIGIN
    );
  });
});
