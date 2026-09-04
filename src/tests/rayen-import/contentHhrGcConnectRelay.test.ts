// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const contentBridgeSource = readFileSync(path.resolve('extension/content-hhr.js'), 'utf8');
const bridgeGenerationSource = readFileSync(path.resolve('extension/bridge-generation.js'), 'utf8');

type PageMessage = { source: unknown; data: Record<string, unknown> };

const createHarness = (
  sendMessage: (message: Record<string, unknown>) => Promise<unknown>
) => {
  let onMessage: ((event: PageMessage) => void) | undefined;
  let onRuntimeMessage:
    | ((message: Record<string, unknown>, sender: unknown, respond: (value: unknown) => void) => unknown)
    | undefined;
  const postMessage = vi.fn();
  const windowObject = {
    location: { origin: 'http://localhost:3001' },
    addEventListener: vi.fn((type: string, listener: (event: PageMessage) => void) => {
      if (type === 'message') onMessage = listener;
    }),
    postMessage,
  };
  const context = vm.createContext({
    window: windowObject,
    chrome: {
      runtime: {
        sendMessage: (message: Record<string, unknown>, callback?: (value: unknown) => void) => {
          if (message.type === 'RAYEN_EXTENSION_RUNTIME_CONTEXT_REQUEST') {
            callback?.({
              version: '0.48.10',
              runtimeGeneration: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            });
            return undefined;
          }
          return sendMessage(message);
        },
        getManifest: () => ({ version: '0.48.10' }),
        lastError: undefined,
        onMessage: {
          addListener: vi.fn(listener => {
            onRuntimeMessage = listener;
          }),
        },
      },
    },
    console,
    HhrRayenMessageContract: {
      types: {
        EXTENSION_RUNTIME_CONTEXT_REQUEST: 'RAYEN_EXTENSION_RUNTIME_CONTEXT_REQUEST',
        GC_CONNECT_REQUEST: 'RAYEN_GC_CONNECT_REQUEST',
      },
    },
  });
  vm.runInContext(bridgeGenerationSource, context, { filename: 'bridge-generation.js' });
  vm.runInContext(contentBridgeSource, context, { filename: 'content-hhr.js' });
  return { onMessage, onRuntimeMessage, postMessage, windowObject };
};

describe('content-hhr · relé de conexión de Gestión de Camas', () => {
  it('traduce la petición de la página al runtime y devuelve el resultado', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true }));
    const { onMessage, postMessage, windowObject } = createHarness(sendMessage);

    onMessage?.({
      source: windowObject,
      data: { type: 'HHR_RAYEN_GC_CONNECT_REQUEST', reqId: 'req-1', renew: true },
    });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        { type: 'HHR_RAYEN_GC_CONNECT_RESULT', reqId: 'req-1', ok: true, error: undefined },
        'http://localhost:3001'
      )
    );
    expect(sendMessage).toHaveBeenCalledWith({ type: 'RAYEN_GC_CONNECT_REQUEST', renew: true });
  });

  it('degrada con ok:false cuando el runtime rechaza', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('sin worker');
    });
    const { onMessage, postMessage, windowObject } = createHarness(sendMessage);

    onMessage?.({
      source: windowObject,
      data: { type: 'HHR_RAYEN_GC_CONNECT_REQUEST', reqId: 'req-2' },
    });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HHR_RAYEN_GC_CONNECT_RESULT',
          reqId: 'req-2',
          ok: false,
          error: expect.stringContaining('sin worker'),
        }),
        'http://localhost:3001'
      )
    );
  });

  it('confirma que el relé HHR pertenece a la versión y generación vigentes', async () => {
    const { onRuntimeMessage } = createHarness(vi.fn());
    const response = new Promise<Record<string, unknown>>(resolve => {
      const keepAlive = onRuntimeMessage?.(
        {
          type: 'RAYEN_EXTENSION_HHR_HEALTH_PING',
          runtimeGeneration: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        },
        {},
        value => resolve(value as Record<string, unknown>)
      );
      expect(keepAlive).toBe(true);
    });

    await expect(response).resolves.toMatchObject({
      ready: true,
      reason: 'connected',
      bridgeVersion: '0.48.10',
      bridgeGeneration: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    });
  });
});
