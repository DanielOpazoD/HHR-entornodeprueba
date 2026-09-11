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
    postMessage,
  };
  const context = vm.createContext({
    window: windowObject,
    chrome: { runtime: { sendMessage } },
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
  return { dispatch, postMessage, sendMessage };
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('content-hhr-sync-bundle relay · cancellation', () => {
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
});
